ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps | grep blog"
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/api/admin/posts"
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker logs autoro-blog-nextjs --tail 10 | grep -i ready"

