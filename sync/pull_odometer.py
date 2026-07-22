#!/usr/bin/env python3
"""Pull the odometer from Toyota's (unofficial) North America API.

Usage:
  .venv/bin/python pull_odometer.py setup   # one-time interactive login (asks for
                                            # your Toyota app credentials, stores
                                            # refresh tokens in tokens.json)
  .venv/bin/python pull_odometer.py pull    # fetch odometer, append to readings.json

This uses the reverse-engineered `toyota-na` library — NOT an official Toyota
API. It can stop working whenever Toyota changes their backend. Credentials are
only ever entered locally by you; only OAuth tokens are stored (tokens.json,
chmod 600, gitignored).
"""
import asyncio
import getpass
import json
import os
import stat
import sys
from datetime import date

from toyota_na.auth import ToyotaOneAuth
from toyota_na.client import ToyotaOneClient
from toyota_na.vehicle.base_vehicle import VehicleFeatures
from toyota_na.vehicle.vehicle import get_vehicles

HERE = os.path.dirname(os.path.abspath(__file__))
TOKENS_FILE = os.path.join(HERE, "tokens.json")
READINGS_FILE = os.path.join(HERE, "readings.json")


def save_tokens(tokens):
    with open(TOKENS_FILE, "w") as f:
        json.dump(tokens, f)
    os.chmod(TOKENS_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 600


def load_tokens():
    if not os.path.exists(TOKENS_FILE):
        sys.exit("No tokens.json — run the `setup` step first.")
    with open(TOKENS_FILE) as f:
        return json.load(f)


async def setup():
    print("Toyota app login (credentials go straight to Toyota, only tokens are stored)")
    username = input("Toyota username/email: ").strip()
    password = getpass.getpass("Toyota password: ")
    auth = ToyotaOneAuth(callback=save_tokens)
    await auth.login(username, password)
    save_tokens(auth.get_tokens())
    client = ToyotaOneClient(auth)
    vehicles = await get_vehicles(client)
    print(f"Logged in. Found {len(vehicles)} vehicle(s):")
    for v in vehicles:
        print(f"  {v._model_year} {v._model_name}  VIN {v._vin}")
    print("Done — tokens saved. The daily job can run now.")


async def pull():
    auth = ToyotaOneAuth(callback=save_tokens, initial_tokens=load_tokens())
    await auth.check_tokens()  # refreshes if needed; new tokens hit the callback
    client = ToyotaOneClient(auth)
    vehicles = await get_vehicles(client)
    if not vehicles:
        sys.exit("No vehicles on this Toyota account.")
    vehicle = vehicles[0]
    await vehicle.update()
    odo = vehicle.features.get(VehicleFeatures.Odometer)
    if odo is None:
        sys.exit("Odometer not reported by the API for this vehicle.")
    value = int(round(float(odo.value)))
    unit = getattr(odo, "unit", "mi")
    if str(unit).lower().startswith("km"):
        value = int(round(value * 0.621371))

    readings = []
    if os.path.exists(READINGS_FILE):
        with open(READINGS_FILE) as f:
            readings = json.load(f)
    today = date.today().isoformat()
    existing = next((r for r in readings if r["date"] == today), None)
    if existing:
        if existing["odometer"] == value:
            print(f"Unchanged: {today} {value} mi")
            return
        existing["odometer"] = value
    else:
        readings.append({"date": today, "odometer": value})
    readings.sort(key=lambda r: r["date"])
    with open(READINGS_FILE, "w") as f:
        json.dump(readings, f, indent=1)
    print(f"Recorded: {today} {value} mi ({len(readings)} readings total)")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "pull"
    asyncio.run(setup() if mode == "setup" else pull())
