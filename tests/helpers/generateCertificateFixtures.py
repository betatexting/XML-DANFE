"""Generate synthetic, self-signed A1 test files. No real identity or secret."""
import base64
import datetime
import json
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID, ObjectIdentifier

password = b"certificate-fixture-only"
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SYNTHETIC TEST CERTIFICATE")])

def make(start, end, with_cnpj=True):
    builder = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
               .public_key(key.public_key()).serial_number(x509.random_serial_number())
               .not_valid_before(datetime.datetime(start, 1, 1))
               .not_valid_after(datetime.datetime(end, 1, 1)))
    if with_cnpj:
        builder = builder.add_extension(x509.SubjectAlternativeName([
            x509.OtherName(ObjectIdentifier("2.16.76.1.3.3"), b"\x0c\x0e14078646000104")
        ]), critical=False)
    return builder.sign(key, hashes.SHA256())

cert = make(2020, 2045)
fixtures = {"password": password.decode()}
for label, certificate, private_key in [
    ("valid", cert, key), ("expired", make(2015, 2018), key),
    ("future", make(2090, 2095), key), ("withoutKey", cert, None),
    ("withoutCnpj", make(2020, 2045, False), key)
]:
    data = pkcs12.serialize_key_and_certificates(b"fixture", private_key, certificate,
                                               None, serialization.BestAvailableEncryption(password))
    fixtures[label] = base64.b64encode(data).decode()
target = Path(__file__).resolve().parent.parent / "fixtures" / "company-certificate.json"
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(fixtures, indent=2), encoding="utf-8")
