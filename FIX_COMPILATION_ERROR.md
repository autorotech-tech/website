# Исправление ошибки компиляции "Unterminated regular expression literal"

## Проблема

При сборке Docker контейнера возникает ошибка:
```
Type error: Unterminated regular expression literal.
  29 |   return true
  30 | }
> 31 | /
```

## Решение

Ошибка возникает в файле `app/api/admin/posts/[id]/index/route.ts` на строке 23-26.

Файл содержит:
```typescript
  return true
}

/**
```

Проблема может быть в том, что после `}` нет пустой строки перед комментарием `/**`, и TypeScript компилятор интерпретирует это как начало регулярного выражения.

## Исправление

Добавить пустую строку после `}`:

```typescript
  return true
}

/**
 * POST /api/admin/posts/[id]/index
```

Или проверить, что файл `route.ts` (не `[id]/index/route.ts`) не содержит поврежденных строк.

## Текущий статус

1. ✅ Файл `route.ts` исправлен
2. ⚠️ Нужно проверить файл `[id]/index/route.ts`
3. ⚠️ Возможно, нужно пересобрать без кеша: `docker-compose build --no-cache blog`


