from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
import base64

key = ec.generate_private_key(ec.SECP256R1())
private_der = key.private_bytes(
    serialization.Encoding.DER,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
public_raw = key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint,
)
enc = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
print("VAPID_PRIVATE_KEY=" + enc(private_der))
print("VAPID_PUBLIC_KEY=" + enc(public_raw))
