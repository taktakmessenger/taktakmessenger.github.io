#!/usr/bin/env python3
"""Crea el fichero de estado del navegador con la sesión de un usuario.

Se usa para verificar la interfaz real sin teclear el formulario a mano.
Uso: python3 scripts/make-storage.py ana_28871@example.com secret123
"""
import json
import sys
import urllib.request

api = "http://127.0.0.1:4000/api"
email, password = sys.argv[1], sys.argv[2]

req = urllib.request.Request(
    f"{api}/auth/login",
    data=json.dumps({"email": email, "password": password}).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as res:
    session = json.load(res)

state = {
    "cookies": [],
    "origins": [
        {
            "origin": "https://work-1-xjohxhesekhmazjg.prod-runtime.all-hands.dev",
            "localStorage": [
                {"name": "taktak_token", "value": session["token"]},
                {"name": "taktak_user", "value": json.dumps(session["user"])},
            ],
        }
    ],
}

with open("/tmp/taktak_storage.json", "w") as fh:
    json.dump(state, fh)

print(f"sesión de {session['user']['username']} guardada en /tmp/taktak_storage.json")
