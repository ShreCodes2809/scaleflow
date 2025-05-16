from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta
import os
import pandas as pd
import requests
import json
from sqlalchemy import create_engine
from concurrent.futures import ThreadPoolExecutor, as_completed

# === CONFIG ===
OUTPUT_FOLDER = "/opt/airflow/macroecon_data_threaded"
INDICATORS = [
    "NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD.ZG", "FP.CPI.TOTL.ZG", "PA.NUS.FCRF", "SL.UEM.TOTL.ZS",
    "NE.EXP.GNFS.ZS", "NE.IMP.GNFS.ZS", "LP.LPI.OVRL.XQ", "IC.COST.INFR.CD", "IC.TIME.INFR",
    "EG.USE.ELEC.KH.PC", "IT.NET.USER.ZS", "IT.CEL.SETS.P2", "NV.AGR.TOTL.ZS", "SP.URB.TOTL.IN.ZS",
    "LP.LPI.INFR.XQ", "LP.LPI.CLEC.XQ", "LP.LPI.TRAC.XQ", "LP.LPI.TIME.XQ", "IS.AIR.GOOD.MT.K1",
    "IS.SHP.GOOD.TU", "IQ.REG.QUAL.XQ", "IQ.GOV.EFF.XQ", "IQ.CORR.XQ", "PV.EST",
    "SL.TLF.CACT.ZS", "SL.IND.EMPL.ZS", "IC.REG.DURS"
]
COUNTRIES = "all"
START_YEAR = 1974
END_YEAR = 2024
MAX_WORKERS = 28
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# === FUNCTION DEFINITIONS ===

def get_total_records(indicator):
    url = (
        f"http://api.worldbank.org/v2/country/{COUNTRIES}/indicator/{indicator}"
        f"?date={START_YEAR}:{END_YEAR}&format=json&per_page=1"
    )
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()[0].get("total", 0)
    except Exception as e:
        print(f"Metadata error for {indicator}: {e}")
        return 0

def fetch_and_save(indicator):
    total = get_total_records(indicator)
    if not total:
        return f"{indicator}: No records"
    url = (
        f"http://api.worldbank.org/v2/country/{COUNTRIES}/indicator/{indicator}"
        f"?date={START_YEAR}:{END_YEAR}&format=json&per_page={total}"
    )
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()[1]
        with open(f"{OUTPUT_FOLDER}/{indicator}.json", "w") as jf:
            json.dump(data, jf, indent=2)
        df = pd.json_normalize(data)
        df.to_csv(f"{OUTPUT_FOLDER}/{indicator}.csv", index=False)
        return f"{indicator}: success"
    except Exception as e:
        return f"{indicator}: failed - {e}"

def extract_all_data():
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_and_save, ind) for ind in INDICATORS]
        for future in as_completed(futures):
            print(future.result())

def merge_and_clean():
    all_dfs = []
    for file in os.listdir(OUTPUT_FOLDER):
        if file.endswith(".csv"):
            df = pd.read_csv(os.path.join(OUTPUT_FOLDER, file))
            all_dfs.append(df)
    if all_dfs:
        combined_df = pd.concat(all_dfs, ignore_index=True)
        combined_df.dropna(subset=["value"], inplace=True)
        combined_df.dropna(subset=["countryiso3code"], inplace=True)
        combined_df = combined_df.drop(["country.id"], axis=1) # country codes might be redundant and unnecessary information since countryisocode already exists
        combined_df = combined_df.drop(['unit', 'obs_status'], axis=1) # all values are NaN
        combined_df.to_csv(f"{OUTPUT_FOLDER}/cleaned_combined.csv", index=False)
        print(f"Cleaned and merged data saved at {OUTPUT_FOLDER}/cleaned_combined.csv")

def load_to_postgres():

    db_uri = "postgresql://airflow:airflow@postgres:5432/airflow"
    engine = create_engine(db_uri)
    df = pd.read_csv(f"{OUTPUT_FOLDER}/cleaned_combined.csv")
    df.to_sql("macroecon_data", engine, if_exists="replace", index=False)
    print("Data loaded into PostgreSQL table 'macroecon_data'")

# === DAG DEFINITION ===

default_args = {
    'owner': 'airflow',
    'depends_on_past': False,
    'start_date': datetime(2024, 1, 1),
    'email_on_failure': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    dag_id='macroeconomic_threaded_fetch_to_postgres',
    default_args=default_args,
    schedule_interval=None,  # run manually or use "0 0 * * *" for daily
    catchup=False,
    tags=['macroeconomics', 'threading', 'postgres'],
) as dag:

    t1_extract = PythonOperator(
        task_id='extract_data',
        python_callable=extract_all_data
    )

    t2_merge_clean = PythonOperator(
        task_id='merge_and_clean',
        python_callable=merge_and_clean
    )

    t3_load_pg = PythonOperator(
        task_id='load_to_postgres',
        python_callable=load_to_postgres
    )

    t1_extract >> t2_merge_clean >> t3_load_pg