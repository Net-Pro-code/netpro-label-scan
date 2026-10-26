# Net-Pro Label Scan

Android app (React Native + Expo) that adds up a grocery shopping list in **Malawi Kwacha (MWK)**. It reads **QR codes**, **product barcodes** and the **printed price label** on a shop shelf, so you don't have to type prices.

Course: CIS-MSD-321 Mobile Solutions Development

## How items get added

| What you point at | What happens |
| --- | --- |
| QR code `name,price` (e.g. `Rice 2kg,4500`) | Added straight away |
| Barcode the app already knows | Added straight away (quantity goes up on repeat scans) |
| New barcode | A form opens. Either type the name and price, or tap **Read the label with the camera instead** |
| Shelf label (tap **Read label**) | The phone photographs the label and reads the name and price (on the phone, offline, Google ML Kit). You check them and tap Save. If a barcode was scanned in the last 30 seconds it is remembered with that price |

Shop barcodes only hold a product number, not the price, so the app keeps its own product list. Reading the label is how that list is filled in automatically.

Reading text from a photo is not perfect (blur, tilt, glare), so the app **always shows the result for you to check** before it goes into the total.

## Screens

- **Scan**: camera, total, item list, Clear / + Add item / Save list, **Read label** button
- **Check label / New barcode / Add item**: pop-up forms (name, price, quantity)
- **Products**: remembered products with prices. Tap one to change the price or forget it
- **History**: saved lists with date and total

## Environment variables (.env)

None. No backend and no API keys. Everything is stored on the phone (AsyncStorage) and works offline.

## Run it

Label reading uses native code (ML Kit), so it does **not** work in Expo Go. Build the APK:

```
npm install
npm install -g eas-cli
eas login
eas init
eas build -p android --profile preview
```

Install the APK on an Android phone and allow camera access.

## Tests

The label-reading logic (`parseLabel.js`) has tests built from real label photos:

```
npm test
```

## Files

- `App.js` screens and logic
- `parseLabel.js` turns OCR text into name and price
- `ocr.js` ML Kit text recognition
- `test-parse.mjs` tests

## Limits

- Android only. The label reader needs the phone's ML Kit, so there is no web version.
- Label names on shelves are often cut short (e.g. "WILD MOUN HONEY"). Edit the name when the app shows it.
- Good light and holding the phone straight on the label give the best reading.
