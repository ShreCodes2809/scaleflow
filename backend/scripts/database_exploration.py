import psycopg2
import pandas as pd

def connect(dbname):
    return psycopg2.connect(
        dbname=dbname,
        user="airflow",   # <-- replace with your username
        password="airflow",  # <-- replace with your password
        host="postgres",
        port="5432"
    )

# Step 1: Connect to 'postgres' and list all available databases
conn = connect("postgres")
conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false;")
databases = [row[0] for row in cur.fetchall()]

print("\n=== Databases Available ===")
for idx, db in enumerate(databases):
    print(f"{idx+1}. {db}")

cur.close()
conn.close()

# Step 2: User selects a database
db_choice = int(input("\nEnter the number of the database you want to explore: ")) - 1
chosen_db = databases[db_choice]

# Step 3: Connect to the chosen database
conn = connect(chosen_db)
cur = conn.cursor()

# Step 4: List all tables in the chosen database
cur.execute("""
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name;
""")
tables = [row[0] for row in cur.fetchall()]

if not tables:
    print(f"\nNo tables found in database '{chosen_db}'!")
else:
    print(f"\n=== Tables in '{chosen_db}' ===")
    for idx, table in enumerate(tables):
        print(f"{idx+1}. {table}")

    # Step 5: User selects a table
    table_choice = int(input("\nEnter the number of the table you want to explore: ")) - 1
    chosen_table = tables[table_choice]

    # Step 6: Show columns and data types
    print(f"\n=== Columns in '{chosen_table}' ===")
    cur.execute(f"""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = '{chosen_table}'
        ORDER BY ordinal_position;
    """)
    columns = cur.fetchall()

    for col_name, data_type in columns:
        print(f"{col_name} ({data_type})")

    # Step 7: Show sample rows
    print(f"\n=== Sample Data from '{chosen_table}' (first 5 rows) ===")
    df = pd.read_sql(f"SELECT * FROM {chosen_table} LIMIT 5;", conn)
    print(df)

cur.close()
conn.close()