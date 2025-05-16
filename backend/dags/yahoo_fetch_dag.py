import yfinance as yf
import pandas as pd
import os
import time
import random
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import glob
from sqlalchemy import create_engine

from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta

def fetch_stock_data_threaded_combined(ticker_csv, output_folder, start_year=2000, end_year=2024,
                                       batch_size=50, threads=20, retry_limit=3, retry_delay=5, batch_pause=15):
    tickers_df = pd.read_csv(ticker_csv)
    tickers = tickers_df['ticker'].dropna().unique().tolist()
    random.shuffle(tickers)  # Optional
    tickers = tickers[:100]

    DEFAULT_START = datetime(start_year, 1, 1)
    END_DATE = datetime(end_year, 12, 31)

    os.makedirs(output_folder, exist_ok=True)
    combined_data = []
    results = []

    def fetch_stock_data(ticker):
        try:
            stock = yf.Ticker(ticker)
            info = stock.info

            founded_year = info.get("founded") or info.get("startDate") or info.get("yearFounded")
            if isinstance(founded_year, int) and founded_year >= start_year:
                start_date = datetime(founded_year, 1, 1)
            else:
                start_date = DEFAULT_START

            hist = stock.history(start=start_date, end=END_DATE)
            time.sleep(random.uniform(1.5, 3.5))

            if hist.empty:
                return None, f"[SKIPPED] {ticker}: No data."

            hist.reset_index(inplace=True)
            hist['ticker'] = ticker
            return hist, f"[SUCCESS] {ticker} from {start_date.year} to {END_DATE.year}"

        except Exception as e:
            if "Rate limit" in str(e) or "Too Many Requests" in str(e):
                return None, f"[RETRY] {ticker}: Rate limited. {e}"
            return None, f"[FAILED] {ticker}: {e}"

    def fetch_with_retries(ticker):
        for attempt in range(retry_limit):
            data, log = fetch_stock_data(ticker)
            if not log.startswith("[RETRY]"):
                return data, log
            time.sleep(retry_delay * (attempt + 1))
        return None, f"[FAILED] {ticker} after {retry_limit} retries"

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=threads) as executor:
            futures = {executor.submit(fetch_with_retries, ticker): ticker for ticker in batch}
            for future in as_completed(futures):
                data, log = future.result()
                ticker = futures[future]  # Make sure we get the correct ticker name
                results.append(log)
                if data is not None:
                    filename = os.path.join(output_folder, f"{ticker}.csv")
                    data.to_csv(filename, index=False)
        time.sleep(batch_pause)

    # Log all results
    with open(os.path.join(output_folder, "fetch_log.txt"), "w") as f:
        f.write("\n".join(results))

    return "Data fetched and saved per ticker. Ready for merging."

def merge_csv_files(source_folder, output_file):
    files = glob.glob(os.path.join(source_folder, "*.csv"))
    files = [f for f in files if "combined" not in f and "cleaned" not in f]

    dataframes = []
    for f in files:
        try:
            df = pd.read_csv(f)
            dataframes.append(df)
        except Exception as e:
            print(f"[SKIP] {f}: {e}")

    if dataframes:
        combined_df = pd.concat(dataframes, ignore_index=True)
        combined_df.to_csv(output_file, index=False)
        print(f"Combined file saved to: {output_file}")
    else:
        print("No valid files found to merge.")

def clean_and_save(input_path, output_path):
    # Load dataset
    df = pd.read_csv(input_path)

    # Drop rows with any missing values (especially for Capital Gains)
    df = df.dropna()

    # Drop columns with too many zeros / not useful
    cols_to_drop = ['Capital Gains', 'Stock Splits', 'Dividends']
    df = df.drop(columns=[col for col in cols_to_drop if col in df.columns])

    # Convert 'Date' to datetime and then to 'YYYY-MM' format
    if 'Date' in df.columns:
        df['Date'] = pd.to_datetime(df['Date'], utc=True, errors='coerce')
        df = df.dropna(subset=['Date'])  # drop rows where date couldn't be parsed
        df['Date'] = df['Date'].dt.to_period('M').astype(str)

    # Normalize column names: lowercase, underscore format
    df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_')

    # Sort by ticker and date
    if 'ticker' in df.columns and 'date' in df.columns:
        df.sort_values(by=['ticker', 'date'], inplace=True)

    # Save cleaned file
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"Cleaned data saved to {output_path}")

def load_to_postgres(clean_csv_path, table_name, db_uri):
    df = pd.read_csv(clean_csv_path)

    engine = create_engine(db_uri)
    with engine.begin() as connection:
        df.to_sql(table_name, connection, if_exists='replace', index=False)
        print(f"Loaded cleaned data into PostgreSQL table: {table_name}")

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'email_on_failure': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    'yahoo_stock_data_pipeline',
    default_args=default_args,
    description='Full ETL: Fetch, merge, clean, and load stock data',
    schedule_interval=None,
    start_date=datetime(2024, 4, 23),
    catchup=False,
    tags=['yfinance', 'etl', 'postgres'],
) as dag:

    fetch_task = PythonOperator(
        task_id='fetch_raw_stock_data',
        python_callable=fetch_stock_data_threaded_combined,
        op_kwargs={
            'ticker_csv': '/opt/airflow/helper_datasets/companies.csv',
            'output_folder': '/opt/airflow/yahoo_finance_dataset/ticker_data_individual',
        }
    )

    merge_task = PythonOperator(  # NEW TASK
        task_id='merge_fetched_data',
        python_callable=merge_csv_files,
        op_kwargs={
            'source_folder': '/opt/airflow/yahoo_finance_dataset/ticker_data_individual',
            'output_file': '/opt/airflow/yahoo_finance_dataset/ticker_data_combined/all_tickers_combined.csv',
        }
    )

    clean_task = PythonOperator(
        task_id='clean_stock_data',
        python_callable=clean_and_save,
        op_kwargs={
            'input_path': '/opt/airflow/yahoo_finance_dataset/ticker_data_combined/all_tickers_combined.csv',
            'output_path': '/opt/airflow/yahoo_finance_dataset/ticker_data_combined/cleaned_tickers_combined.csv'
        }
    )

    load_task = PythonOperator(
        task_id='load_to_postgres',
        python_callable=load_to_postgres,
        op_kwargs={
            'clean_csv_path': '/opt/airflow/yahoo_finance_dataset/ticker_data_combined/cleaned_tickers_combined.csv',
            'table_name': 'cleaned_yahoo_stock_data',
            'db_uri': 'postgresql://airflow:airflow@postgres:5432/airflow'
        }
    )

    # Final task order
    fetch_task >> merge_task >> clean_task >> load_task