import psycopg2
import sys

PGPASSWORD = "supabase_password_e97577f974376e8d"
hosts = ["swoop.autoro.tech", "api.autoro.tech"]
ports = [5433, 5432, 6543]

print("Attempting remote postgres connections...")
connected = False
for host in hosts:
    for port in ports:
        try:
            print(f"Connecting to {host}:{port}...")
            conn = psycopg2.connect(
                host=host, port=port, dbname="postgres",
                user="supabase_admin", password=PGPASSWORD,
                connect_timeout=3
            )
            print(f"SUCCESS connected to {host}:{port}!")
            conn.close()
            connected = True
            break
        except Exception as e:
            print(f"Failed: {e}")
    if connected:
        break
