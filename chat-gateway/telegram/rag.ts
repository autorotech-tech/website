import type { RagChunk, RagResult } from "./types.js";

const RAG_TIMEOUT_MS = Number(process.env.CHAT_AGENT_RAG_TIMEOUT_MS || 8_000);
const RAG_TOP_K = Number(process.env.CHAT_AGENT_RAG_TOP_K || 10);

export function formatKnowledgeBlock(chunks: RagChunk[]): string {
  if (!chunks.length) return "";
  return chunks
    .map((c, i) => {
      const src = c.source ? ` (${c.source})` : "";
      return `[${i + 1}]${src}\n${c.content}`;
    })
    .join("\n\n");
}

/** Test-only mock. Production getRagContext never calls this unless CHAT_AGENT_RAG_MOCK=true. */
export async function mockGetRagContext(_botId: string, userQuery: string): Promise<RagResult> {
  const q = String(userQuery || "").trim();
  if (!q) return { chunks: [], degraded: true, source: "mock" };
  return {
    chunks: [
      {
        content: "Это тестовый фрагмент базы знаний. Используйте только для unit-тестов.",
        source: "mock",
        similarity: 1,
      },
    ],
    degraded: false,
    source: "mock",
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("rag_timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function embedQuery(text: string): Promise<number[] | null> {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (geminiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text }] },
        }),
      },
    );
    const data = (await res.json().catch(() => null)) as { embedding?: { values?: number[] } } | null;
    const values = data?.embedding?.values;
    if (Array.isArray(values) && values.length) return values;
  }

  const ollamaUrl = String(process.env.OLLAMA_URL || "").replace(/\/$/, "");
  if (ollamaUrl) {
    const model = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    const data = (await res.json().catch(() => null)) as { embedding?: number[] } | null;
    if (Array.isArray(data?.embedding) && data.embedding.length) return data.embedding;
  }
  return null;
}

async function searchPgvector(botId: string, embedding: number[]): Promise<RagChunk[]> {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !key) return [];
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/match_bot_documents`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: embedding,
      match_count: RAG_TOP_K,
      filter: { bot_id: botId },
    }),
  });
  const rows = (await res.json().catch(() => null)) as Array<{
    content?: string;
    metadata?: { source?: string; title?: string };
    similarity?: number;
  }> | null;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      content: String(r.content || "").trim(),
      source: String(r.metadata?.title || r.metadata?.source || ""),
      similarity: Number(r.similarity || 0),
    }))
    .filter((c) => c.content);
}

async function searchChroma(botId: string, embedding: number[] | null, query: string): Promise<RagChunk[]> {
  const chromaUrl = String(process.env.CHROMA_URL || "").replace(/\/$/, "");
  if (!chromaUrl) return [];
  const identityRes = await fetch(`${chromaUrl}/api/v2/auth/identity`);
  const identity = (await identityRes.json().catch(() => null)) as {
    tenant?: string;
    databases?: string[];
  } | null;
  const tenant = identity?.tenant || "default_tenant";
  const db = (identity?.databases && identity.databases[0]) || "default_database";
  const name = `chat_agent_${botId}`;
  const colRes = await fetch(
    `${chromaUrl}/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(name)}`,
  );
  if (!colRes.ok) return [];
  const col = (await colRes.json().catch(() => null)) as { id?: string } | null;
  const collectionId = col?.id || name;
  const body: Record<string, unknown> = {
    n_results: RAG_TOP_K,
    include: ["documents", "metadatas", "distances"],
  };
  if (embedding) body.query_embeddings = [embedding];
  else body.query_texts = [query];
  const qRes = await fetch(
    `${chromaUrl}/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(collectionId)}/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await qRes.json().catch(() => null)) as {
    documents?: string[][];
    metadatas?: Array<Array<{ source?: string; title?: string } | null>>;
    distances?: number[][];
  } | null;
  const docs = data?.documents?.[0] || [];
  const metas = data?.metadatas?.[0] || [];
  const dists = data?.distances?.[0] || [];
  return docs
    .map((content, i) => ({
      content: String(content || "").trim(),
      source: String(metas[i]?.title || metas[i]?.source || ""),
      similarity: typeof dists[i] === "number" ? 1 - dists[i] : undefined,
    }))
    .filter((c) => c.content);
}

export async function getRagContext(botId: string, userQuery: string): Promise<RagResult> {
  if (String(process.env.CHAT_AGENT_RAG_MOCK || "").toLowerCase() === "true") {
    return mockGetRagContext(botId, userQuery);
  }

  const query = String(userQuery || "").trim();
  if (!query) return { chunks: [], degraded: true, source: "empty" };

  try {
    return await withTimeout(getRagContextInner(botId, query), RAG_TIMEOUT_MS);
  } catch {
    return { chunks: [], degraded: true, source: "empty" };
  }
}

async function getRagContextInner(botId: string, query: string): Promise<RagResult> {
  const embedding = await embedQuery(query).catch(() => null);

  if (embedding) {
    const pg = await searchPgvector(botId, embedding).catch(() => []);
    if (pg.length) return { chunks: pg, degraded: false, source: "pgvector" };
  }

  const chroma = await searchChroma(botId, embedding, query).catch(() => []);
  if (chroma.length) return { chunks: chroma, degraded: false, source: "chroma" };

  return { chunks: [], degraded: true, source: "empty" };
}
