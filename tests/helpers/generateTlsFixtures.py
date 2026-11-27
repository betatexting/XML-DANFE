"""Synthetic certificates for chain, hostname and validity tests only."""
import json
import datetime
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
root_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SYNTHETIC TLS TEST ROOT")])
root = (x509.CertificateBuilder().subject_name(root_name).issuer_name(root_name)
        .public_key(root_key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime(2020, 1, 1)).not_valid_after(datetime.datetime(2045, 1, 1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(root_key, hashes.SHA256()))

def leaf(host, start, end):
    return (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]))
            .issuer_name(root_name).public_key(leaf_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime(start, 1, 1)).not_valid_after(datetime.datetime(end, 1, 1))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(root_key, hashes.SHA256()))

data = {
    "root": root.public_bytes(serialization.Encoding.PEM).decode(),
    "key": leaf_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
}
for name, cert in [("valid", leaf("localhost", 2020, 2045)), ("expired", leaf("localhost", 2015, 2018)), ("wrongHost", leaf("other.invalid", 2020, 2045))]:
    data[name] = cert.public_bytes(serialization.Encoding.PEM).decode()
target = Path(__file__).resolve().parent.parent / "fixtures" / "sefaz-tls.json"
target.write_text(json.dumps(data, indent=2), encoding="utf-8")
