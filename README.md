# Net-Pro Label Scan

Android app (React Native + Expo) that adds up a grocery shopping list in **Malawi Kwacha (MWK)**. It reads **QR codes**, **product barcodes** and the **printed price label** on a shop shelf, so you don't have to type prices.

Course: CIS-MSD-321 Mobile Solutions Development

## Links

- GitHub repository: https://github.com/Net-Pro-code/netpro-label-scan
- Hosted web version: https://funny-dieffenbachia-da05b0.netlify.app/
- Android app (APK, full version): https://expo.dev/accounts/rodmas/projects/netpro-label-scan/builds/581193d3-9755-4eb4-9a71-eea92d2a058e

## How items get added

| What you point at                           | What happens                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| QR code `name,price` (e.g. `Rice 2kg,4500`) | Added straight away                                                                                                                                                                                                |
| Barcode the app already knows               | Added straight away (quantity goes up on repeat scans)                                                                                                                                                             |
| New barcode                                 | A form opens. Either type the name and price, or tap **Read the label with the camera instead**                                                                                                                    |
| Shelf label (tap **Read label**)            | The phone photographs the label and reads the name and price (on the phone, offline, Google ML Kit). You check them and tap Save. If a barcode was scanned in the last 30 seconds it is remembered with that price |

Shop barcodes only hold a product number, not the price, so the app keeps its own product list. Reading the label is how that list is filled in automatically.

The reader copes with the label styles seen so far: white labels (name above the price, `MK: 6695`), yellow labels (name beside the price) and labels with two-line names. It also reads the barcode number printed on the label and only trusts it if the check digit is right. A product the app already knows, at the same price, is added without any form.

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

## Build and host the web version

```
npx expo install react-dom react-native-web @expo/metro-runtime
npx expo export --platform web
```

Upload the `dist` folder to a static host such as Netlify.

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

- The **Android app is the full version**. Reading shelf labels needs the phone's ML Kit, so the hosted web version has no label reading: use **Add item**, the Products and History screens, and QR scanning with a webcam.
- Label names on shelves are often cut short (e.g. "WILD MOUN HONEY"). Edit the name when the app shows it.
- Good light and holding the phone straight on the label give the best reading.
