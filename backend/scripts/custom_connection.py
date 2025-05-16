from airflow import settings
from airflow.models import Connection

def create_postgres_connection():
    conn_id = "shre_postgres_conn_id"  # The same ID used in your DAG

    session = settings.Session()

    # Check if connection already exists
    existing_conn = session.query(Connection).filter(Connection.conn_id == conn_id).first()

    if existing_conn:
        print(f"Connection with conn_id '{conn_id}' already exists. Skipping creation.")
    else:
        new_conn = Connection(
            conn_id=conn_id,
            conn_type="postgres",
            host="postgres",            # Host inside Docker (use 'postgres' if docker-compose service name is postgres)
            schema="airflow",            # Database name
            login="airflow",       # Your Postgres username
            password="airflow",    # Your Postgres password
            port=5432                    # Default Postgres port
        )
        session.add(new_conn)
        session.commit()
        print(f"Connection '{conn_id}' created successfully.")

if __name__ == "__main__":
    create_postgres_connection()