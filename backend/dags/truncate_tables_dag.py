from airflow import DAG
from airflow.providers.postgres.operators.postgres import PostgresOperator
from datetime import datetime, timedelta
from airflow.models import Variable

mode = Variable.get("stress_test_mode", "super_light")

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    'truncate_tables_dag',
    default_args=default_args,
    description='DAG to truncate target tables in PostgreSQL',
    schedule_interval=None,  # Trigger manually
    start_date=datetime(2024, 4, 27),
    catchup=False,
    tags=['truncate', 'postgres', 'cleanup'],
) as dag:

    # Example: Truncating a table named 'cleaned_stock_data'
    truncate_cleaned_stock_data = PostgresOperator(
        task_id=f'stock_data_{mode}',
        postgres_conn_id='postgres_default',  # Airflow default Postgres connection
        sql='TRUNCATE TABLE cleaned_stock_data RESTART IDENTITY CASCADE;',
    )

    # Execution order (if needed)
    truncate_cleaned_stock_data