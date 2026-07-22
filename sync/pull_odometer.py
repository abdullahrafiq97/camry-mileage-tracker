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
from urllib.parse import parse_qs, urlencode, urlparse

import aiohttp
from toyota_na.auth import ToyotaOneAuth
from toyota_na.client import ToyotaOneClient
from toyota_na.exceptions import LoginError
from toyota_na.vehicle.base_vehicle import VehicleFeatures
from toyota_na.vehicle.vehicle import get_vehicles

HERE = os.path.dirname(os.path.abspath(__file__))
TOKENS_FILE = os.path.join(HERE, "tokens.json")
READINGS_FILE = os.path.join(HERE, "readings.json")


class PatchedAuth(ToyotaOneAuth):
    """toyota-na 2.1.1's login broke when Toyota added steps to their journey.

    The journey now is: NameCallback "ui_locales" -> HiddenValueCallback
    devicePrint -> NameCallback "User Name" + ChoiceCallback [Local, Google,
    Facebook, Apple] -> PasswordCallback -> tokenId. This override answers the
    new callbacks (locale = en-US, method = Local) and surfaces Toyota's error
    messages ("User Not Found", etc.) instead of a generic LoginError.
    """

    async def authorize(self, username, password):
        headers = {"Accept-API-Version": "resource=2.1, protocol=1.0"}
        async with aiohttp.ClientSession() as session:
            data = {}
            for _ in range(12):
                for cb in data.get("callbacks", []):
                    kind = cb["type"]
                    prompt = next((o["value"] for o in cb.get("output", [])
                                   if o.get("name") == "prompt"), "")
                    if kind == "NameCallback":
                        if prompt == "ui_locales":
                            cb["input"][0]["value"] = "en-US"
                        else:
                            cb["input"][0]["value"] = username
                    elif kind == "PasswordCallback":
                        cb["input"][0]["value"] = password
                    elif kind == "ChoiceCallback":
                        choices = next((o["value"] for o in cb.get("output", [])
                                        if o.get("name") == "choices"), [])
                        if "Local" in choices:
                            cb["input"][0]["value"] = choices.index("Local")
                    elif kind == "TextOutputCallback":
                        msg = next((o["value"] for o in cb.get("output", [])
                                    if o.get("name") == "message"), "")
                        mtype = next((o["value"] for o in cb.get("output", [])
                                      if o.get("name") == "messageType"), "0")
                        if str(mtype) == "2":
                            sys.exit(f"Toyota rejected the login: {msg}\n"
                                     "(If this says User Not Found, use the exact email on the "
                                     "Toyota account; if it mentions a code/OTP, tell Claude.)")
                    # HiddenValueCallback (devicePrint): send back as-is
                async with session.post(self.AUTHENTICATE_URL, json=data, headers=headers) as resp:
                    if resp.status != 200:
                        sys.exit(f"Toyota login failed: HTTP {resp.status}: {await resp.text()}")
                    data = await resp.json()
                if "tokenId" in data:
                    break
            else:
                kinds = [cb.get("type") for cb in data.get("callbacks", [])]
                sys.exit(f"Login journey didn't complete; last step had callbacks {kinds}. "
                         "Toyota may have changed the flow again.")

            # Exchange the session token for an OAuth authorization code
            # (same as the stock library).
            headers["Cookie"] = f"iPlanetDirectoryPro={data['tokenId']}"
            auth_params = {
                "client_id": "oneappsdkclient",
                "scope": "openid profile write",
                "response_type": "code",
                "redirect_uri": "com.toyota.oneapp:/oauth2Callback",
                "code_challenge": "plain",
                "code_challenge_method": "plain",
            }
            async with session.get(
                f"{self.AUTHORIZE_URL}?{urlencode(auth_params)}",
                headers=headers, allow_redirects=False,
            ) as resp:
                if resp.status != 302:
                    raise LoginError()
                query = parse_qs(urlparse(resp.headers["Location"]).query)
                if "code" not in query:
                    raise LoginError()
                return query["code"][0]


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
    auth = PatchedAuth(callback=save_tokens)
    await auth.login(username, password)
    save_tokens(auth.get_tokens())
    client = ToyotaOneClient(auth)
    vehicles = await get_vehicles(client)
    print(f"Logged in. Found {len(vehicles)} vehicle(s):")
    for v in vehicles:
        print(f"  {v._model_year} {v._model_name}  VIN {v._vin}")
    print("Done — tokens saved. The daily job can run now.")


async def pull():
    auth = PatchedAuth(callback=save_tokens, initial_tokens=load_tokens())
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
