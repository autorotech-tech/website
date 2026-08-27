ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w 'Blog direct (3002): %{http_code}\n' http://localhost:3002/api/admin/posts"
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w 'Nginx proxy: %{http_code}\n' -H 'Host: cdn.autoro.tech' http://localhost/api/blog/admin/posts"

