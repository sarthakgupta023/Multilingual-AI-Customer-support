# TeleNova Network Troubleshooting & APN Configuration

## Document ID: TN-POL-08
**Last Updated:** October 2026  
**Applicability:** All TeleNova 4G / 5G Mobile Subscribers

---

### 1. Official TeleNova Access Point Name (APN) Settings
For mobile data and multimedia messaging to function properly, verify APN parameters:

| Field | Configuration Value |
| :--- | :--- |
| **Name** | TeleNova Internet |
| **APN** | `telenova.net` |
| **Proxy / Port** | Not Set (Blank) |
| **Username / Password**| Not Set (Blank) |
| **Server** | Not Set |
| **MMSC / MMS Proxy** | Not Set |
| **MCC** | 404 or 405 (Automatic based on circle) |
| **MNC** | Keep Default SIM Value |
| **Authentication Type**| PAP or CHAP |
| **APN Protocol** | IPv4 / IPv6 |
| **APN Roaming Protocol**| IPv4 / IPv6 |
| **Bearer** | Unspecified / LTE / NR |

To receive APN settings automatically via SMS, text `SETTINGS` to **1925**.

---

### 2. Common Fixes for "No Service" or Slow Data Speeds
1. **Airplane Mode Toggle:** Turn on Airplane Mode for 15 seconds, then turn it off to trigger local base station re-handshake.
2. **Preferred Network Type:** Navigate to `Settings > Mobile Network > Preferred Network Type` and select `5G/4G/3G Auto`.
3. **VoLTE Toggle:** Ensure `VoLTE Calls` is toggled `ON`. If VoLTE is disabled, HD voice calling and simultaneous data usage will not work.
4. **Network Reset:** Navigate to `Settings > System > Reset Options > Reset Wi-Fi, mobile & Bluetooth`.

---

### 3. Call Drop Regulatory Compensation Policy
Under TeleNova Service Quality Commitments and TRAI regulations:
- Customers experiencing call drops due to network fault are entitled to a credit of **₹1 per call drop**, capped at a maximum of **₹3 per calendar day**.
- Call drop credit is credited automatically to your prepaid balance or adjusted on your postpaid monthly invoice.
