import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Vibration,
  StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readTextLines } from './ocr';
import { parseLabel } from './parseLabel';
 
const CURRENT_KEY = 'grocery_current';
const HISTORY_KEY = 'grocery_history';
const PRODUCTS_KEY = 'grocery_products';

// Every barcode/QR type the camera should look for
const CODE_TYPES = [
  'qr',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'code39',
  'code93',
  'code128',
  'itf14',
  'codabar',
];

// Products already known to the app (from the shop shelf labels).
// Anything else is learned the first time it is scanned.
const SEED_PRODUCTS = {
  '800765': { name: 'K/Kitchen Wild Mountain Honey 500g', price: 12100 },
  '860003357767': { name: 'K/Kitchen Wild Mountain Honey 500g', price: 12100 },
  '401735': { name: 'Bigtree Binto BBQ Spice 55g', price: 2550 },
  '818436': { name: 'Nyanja Chilli Sauce Piri-Piri Hot 100ml', price: 2000 },
  '808756': { name: 'Robertsons Peppercorn Grinder', price: 13750 },
  '6001020011797': { name: 'Safari Peanuts & Raisins', price: 4160 },
};

// Make the same product always give the same key:
// removes the *...* Code 39 markers and leading zeros (06001020011797 = 6001020011797)
function normalizeCode(raw) {
  let c = String(raw).trim().replace(/^\*+|\*+$/g, '');
  if (/^\d+$/.test(c)) c = c.replace(/^0+(?=\d)/, '');
  return c;
}

// Alert.alert does nothing in a web browser, so use the browser's own dialogs there
function notify(title, message) {
  if (Platform.OS === 'web') {
    window.alert(message ? title + '\n\n' + message : title);
  } else {
    Alert.alert(title, message);
  }
}

function confirmAction(title, message, confirmLabel, onConfirm) {
  if (Platform.OS === 'web') {
    if (window.confirm(title + '\n\n' + message)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  }
}
 
// Same QR code seen again within this many milliseconds is ignored
// (stops one scan from adding twice). Lower = faster repeat scanning.
const SCAN_DELAY = 1500;
const MAX_QTY = 9999;
 
// ---------- helpers ----------
 
// QR format: "Rice 2kg,4500"  (name,price) - price is the part after the LAST comma
function parseQR(data) {
  if (typeof data !== 'string') return null;
  const idx = data.lastIndexOf(',');
  if (idx === -1) return null;
  const name = data.slice(0, idx).trim();
  const priceText = data
    .slice(idx + 1)
    .replace(/mwk/gi, '')
    .replace(/\s/g, '');
  if (!name || !/^\d+(\.\d+)?$/.test(priceText)) return null;
  return { name, price: parseFloat(priceText) };
}
 
function formatMWK(n) {
  const [whole, dec] = Number(n).toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return 'MWK ' + (dec === '00' ? withCommas : withCommas + '.' + dec);
}
 
const qtyOf = (i) => i.qty || 1; // older saved items have no qty
const lineTotal = (i) => i.price * qtyOf(i);
const sumItems = (items) => items.reduce((s, i) => s + lineTotal(i), 0);
const countUnits = (items) => items.reduce((s, i) => s + qtyOf(i), 0);
 
function formatDate(iso) {
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}  ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
 
// ---------- app ----------
 
export default function App() {
  const [tab, setTab] = useState('scan');
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('Scan a QR code or barcode');
  const [products, setProducts] = useState(SEED_PRODUCTS);
  const [messageType, setMessageType] = useState('info'); // info | ok | error
  const [expandedId, setExpandedId] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const lastScan = useRef({ data: null, time: 0 });
 
  // manual "Add item" form
  const [manualOpen, setManualOpen] = useState(false);
  const [mName, setMName] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [mQty, setMQty] = useState('1');

  // "new barcode" / "edit product" form
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnMode, setLearnMode] = useState('learn'); // learn | edit
  const [learnCode, setLearnCode] = useState('');
  const [lName, setLName] = useState('');
  const [lPrice, setLPrice] = useState('');
  const [lQty, setLQty] = useState('1');
  const learnOpenRef = useRef(false); // stops the camera scanning while the form is open
  const cameraRef = useRef(null);
  const pendingCode = useRef({ code: '', time: 0 }); // last barcode scanned, to attach to a label photo
  const [busy, setBusy] = useState(false);
  const [lNote, setLNote] = useState('');

  // load saved data
  useEffect(() => {
    (async () => {
      try {
        const cur = await AsyncStorage.getItem(CURRENT_KEY);
        const hist = await AsyncStorage.getItem(HISTORY_KEY);
        const prod = await AsyncStorage.getItem(PRODUCTS_KEY);
        if (cur) setItems(JSON.parse(cur).map((i) => ({ ...i, qty: qtyOf(i) })));
        if (hist) setHistory(JSON.parse(hist));
        // first run uses the built-in products; after that the saved list is the truth
        if (prod) setProducts(JSON.parse(prod));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);
 
  // keep the in-progress list and history saved
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(CURRENT_KEY, JSON.stringify(items)).catch(() => {});
  }, [items, loaded]);
 
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history)).catch(() => {});
  }, [history, loaded]);
 
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)).catch(() => {});
  }, [products, loaded]);

  const total = sumItems(items);
  const units = countUnits(items);

  function handleScan({ type, data }) {
    if (learnOpenRef.current) return; // a form is open, ignore the camera
    const now = Date.now();
    if (lastScan.current.data === data && now - lastScan.current.time < SCAN_DELAY) return;
    lastScan.current = { data, time: now };

    // 1) Barcode on a product or shelf label -> look it up (or learn it)
    if (type !== 'qr') {
      const code = normalizeCode(data);
      if (!code) return;
      const known = products[code];
      pendingCode.current = { code, time: Date.now() };
      if (known) {
        Vibration.vibrate(80);
        addToList({ name: known.name, price: known.price }, 1);
        setMessageType('ok');
        setMessage(`Added: ${known.name}  ${formatMWK(known.price)}`);
      } else {
        Vibration.vibrate([0, 80, 60, 80]);
        openLearn(code);
      }
      return;
    }

    // 2) QR code with "name,price" inside
    const parsed = parseQR(data);
    if (!parsed) {
      Vibration.vibrate([0, 150, 100, 150]);
      setMessageType('error');
      setMessage('Unreadable code. Expected: name,price');
      return;
    }
    Vibration.vibrate(80);
    addToList(parsed, 1);
    setMessageType('ok');
    setMessage(`Added: ${parsed.name}  ${formatMWK(parsed.price)}`);
  }
 
  // same item (same name and price) -> add to its quantity, move it to the top
  function addToList(parsed, count) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.name === parsed.name && i.price === parsed.price);
      if (idx >= 0) {
        const updated = { ...prev[idx], qty: Math.min(qtyOf(prev[idx]) + count, MAX_QTY) };
        return [updated, ...prev.filter((_, k) => k !== idx)];
      }
      return [
        {
          id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
          ...parsed,
          qty: Math.min(count, MAX_QTY),
        },
        ...prev,
      ];
    });
  }
 
  // ----- new barcode (learn) and edit product -----
  function showLearn(mode, code, name, price, note) {
    learnOpenRef.current = true;
    setLearnMode(mode);
    setLearnCode(code);
    setLName(name);
    setLPrice(price);
    setLQty('1');
    setLNote(note || '');
    setLearnOpen(true);
  }

  // Take a photo of the shelf label, read the text, show name + price to confirm
  async function readLabelPhoto() {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setMessageType('info');
    setMessage('Reading label...');
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      const lines = await readTextLines(pic.uri);
      const parsed = parseLabel(lines, pic.height);
      if (!parsed.price) {
        Vibration.vibrate([0, 150, 100, 150]);
        setMessageType('error');
        setMessage('No price found. Move closer so the label fills the frame.');
        return;
      }
      Vibration.vibrate(80);
      // attach the barcode only if it was scanned a moment ago
      const fresh = Date.now() - pendingCode.current.time < 30000;
      const code = fresh ? pendingCode.current.code : '';
      const saved = code ? products[code] : null;
      const note =
        saved && saved.price !== parsed.price
          ? `Saved price was ${formatMWK(saved.price)} - saving will update it.`
          : '';
      showLearn('label', code, parsed.name, String(parsed.price), note);
    } catch (e) {
      setMessageType('error');
      setMessage('Could not read the label. Try again or use + Add item.');
    } finally {
      setBusy(false);
    }
  }

  // from the "new barcode" form: go back to the camera and read the label instead
  function readLabelForCode() {
    pendingCode.current = { code: learnCode, time: Date.now() };
    learnOpenRef.current = false;
    lastScan.current = { data: lastScan.current.data, time: Date.now() + 4000 };
    setLearnOpen(false);
    setMessageType('info');
    setMessage('Aim at the label, then tap Read label');
  }

  function openLearn(code) {
    setMessageType('info');
    setMessage('New barcode - enter its name and price');
    showLearn('learn', code, '', '');
  }

  function openEdit(code) {
    const p = products[code];
    if (!p) return;
    showLearn('edit', code, p.name, String(p.price));
  }

  function closeLearn(saved) {
    learnOpenRef.current = false;
    // after Cancel, ignore the same barcode for a moment so the form does not pop straight back up
    lastScan.current = { data: lastScan.current.data, time: Date.now() + (saved === true ? 0 : 2000) };
    setLearnOpen(false);
  }

  function submitLearn() {
    const name = lName.trim();
    const priceText = lPrice.replace(/,/g, '').replace(/mwk/gi, '').replace(/\s/g, '');
    const price = parseFloat(priceText);
    const qty = parseInt(lQty.replace(/[^0-9]/g, ''), 10) || 1;

    if (!name) {
      notify('Missing name', 'Type the item name.');
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(priceText) || !(price > 0)) {
      notify('Invalid price', 'Type the price as a number, e.g. 4160');
      return;
    }
    if (learnCode) setProducts((prev) => ({ ...prev, [learnCode]: { name, price } }));
    if (learnMode !== 'edit') {
      addToList({ name, price }, qty);
      setMessageType('ok');
      setMessage(
        `${learnCode ? 'Saved & added' : 'Added'}: ${name}${qty > 1 ? ' × ' + qty : ''}`
      );
    }
    closeLearn(true);
  }

  function deleteProduct() {
    const code = learnCode;
    confirmAction(
      'Forget this product?',
      'The next scan of this barcode will ask for its name and price again.',
      'Forget',
      () => {
        setProducts((prev) => {
          const next = { ...prev };
          delete next[code];
          return next;
        });
        closeLearn();
      }
    );
  }

  // ----- manual entry (no QR code needed) -----
  function openManual() {
    setMName('');
    setMPrice('');
    setMQty('1');
    setManualOpen(true);
  }
 
  function submitManual() {
    const name = mName.trim();
    const priceText = mPrice.replace(/,/g, '').replace(/mwk/gi, '').replace(/\s/g, '');
    const price = parseFloat(priceText);
    const qty = parseInt(mQty.replace(/[^0-9]/g, ''), 10) || 1;
 
    if (!name) {
      notify('Missing name', 'Type the item name.');
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(priceText) || !(price > 0)) {
      notify('Invalid price', 'Type the price as a number, e.g. 4500');
      return;
    }
    addToList({ name, price }, qty);
    setManualOpen(false);
    setMessageType('ok');
    setMessage(`Added: ${name}${qty > 1 ? ' × ' + qty : ''}`);
  }
 
  function changeQty(id, delta) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, qty: Math.min(Math.max(qtyOf(i) + delta, 1), MAX_QTY) } : i
      )
    );
  }
 
  function setQty(id, text) {
    const n = parseInt(String(text).replace(/[^0-9]/g, ''), 10);
    const qty = !n || n < 1 ? 1 : Math.min(n, MAX_QTY);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
  }
 
  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }
 
  function clearAll() {
    if (items.length === 0) return;
    confirmAction('Clear list?', 'This removes all scanned items.', 'Clear', () => setItems([]));
  }
 
  function saveList() {
    if (items.length === 0) {
      notify('Nothing to save', 'Scan at least one item first.');
      return;
    }
    const entry = {
      id: String(Date.now()),
      date: new Date().toISOString(),
      total,
      items,
    };
    setHistory((prev) => [entry, ...prev]);
    setItems([]);
    setMessageType('info');
    setMessage('List saved. Scan a QR code or barcode');
    notify('Saved', `Total ${formatMWK(total)} saved to History.`);
  }
 
  function deleteHistory(id) {
    confirmAction('Delete this list?', 'This cannot be undone.', 'Delete', () =>
      setHistory((prev) => prev.filter((h) => h.id !== id))
    );
  }
 
  // ---------- screens ----------
 
  function renderScan() {
    const cameraReady = !!(permission && permission.granted);
    return (
      <View style={{ flex: 1 }}>
        {/* Camera with corner-only frame and hint label on top */}
        <View style={styles.cameraWrap}>
          {cameraReady ? (
            <>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: CODE_TYPES }}
                onBarcodeScanned={handleScan}
              />
              <View style={styles.frame} pointerEvents="none">
                <View style={[styles.corner, styles.tl]} />
                <View style={[styles.corner, styles.tr]} />
                <View style={[styles.corner, styles.bl]} />
                <View style={[styles.corner, styles.br]} />
              </View>
            </>
          ) : (
            <View style={styles.noCamera}>
              <Text style={styles.noCameraText}>
                Camera access is needed to scan QR codes and barcodes.
              </Text>
              {permission ? (
                <TouchableOpacity style={styles.allowBtn} onPress={requestPermission}>
                  <Text style={styles.allowBtnText}>Allow camera</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.noCameraSub}>You can still use "+ Add item" below.</Text>
            </View>
          )}
          {cameraReady && Platform.OS !== 'web' ? (
            <TouchableOpacity
              style={[styles.readBtn, busy && styles.btnDisabled]}
              onPress={readLabelPhoto}
              disabled={busy}
            >
              <Text style={styles.readBtnText}>{busy ? 'Reading...' : '📷 Read label'}</Text>
            </TouchableOpacity>
          ) : null}
          <View
            pointerEvents="none"
            style={[
              styles.hint,
              messageType === 'ok' && styles.hintOk,
              messageType === 'error' && styles.hintError,
            ]}
          >
            <Text style={styles.hintText} numberOfLines={1}>
              {message}
            </Text>
          </View>
        </View>
 
        {/* Total card */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>
            TOTAL ({units} item{units === 1 ? '' : 's'})
          </Text>
          <Text style={styles.totalValue}>{formatMWK(total)}</Text>
        </View>
 
        {/* Items */}
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8 }}
          data={items}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>No items added yet. Scan a QR code or barcode to add.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.removeBtn}>
                  <Text style={styles.removeText}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.rowBottom}>
                <Text style={styles.unitPrice}>{formatMWK(item.price)} each</Text>
 
                <View style={styles.stepper}>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => changeQty(item.id, -1)}>
                    <Text style={styles.stepText}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    key={item.id + '-' + qtyOf(item)}
                    style={styles.qtyInput}
                    defaultValue={String(qtyOf(item))}
                    keyboardType="number-pad"
                    maxLength={4}
                    selectTextOnFocus
                    onEndEditing={(e) => setQty(item.id, e.nativeEvent.text)}
                  />
                  <TouchableOpacity style={styles.stepBtn} onPress={() => changeQty(item.id, 1)}>
                    <Text style={styles.stepText}>+</Text>
                  </TouchableOpacity>
                </View>
 
                <Text style={styles.rowPrice}>{formatMWK(lineTotal(item))}</Text>
              </View>
            </View>
          )}
        />
 
        {/* Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={clearAll}>
            <Text style={styles.secondaryBtnText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { flex: 1.3 }]} onPress={openManual}>
            <Text style={styles.secondaryBtnText}>+ Add item</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 1.6 }, items.length === 0 && styles.btnDisabled]}
            onPress={saveList}
          >
            <Text style={styles.primaryBtnText}>Save list</Text>
          </TouchableOpacity>
        </View>
 
        {/* Manual entry (no QR code) */}
        <Modal
          visible={manualOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setManualOpen(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Add item manually</Text>
 
              <Text style={styles.fieldLabel}>Item name</Text>
              <TextInput
                style={styles.field}
                value={mName}
                onChangeText={setMName}
                placeholder="e.g. Sugar 1kg"
                placeholderTextColor="#9ca3af"
                autoFocus
              />
 
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.fieldLabel}>Price (MWK)</Text>
                  <TextInput
                    style={styles.field}
                    value={mPrice}
                    onChangeText={setMPrice}
                    placeholder="e.g. 2300"
                    placeholderTextColor="#9ca3af"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <TextInput
                    style={styles.field}
                    value={mQty}
                    onChangeText={setMQty}
                    keyboardType="number-pad"
                    maxLength={4}
                    selectTextOnFocus
                  />
                </View>
              </View>
 
              <Text style={styles.sheetTotal}>
                Line total:{' '}
                {formatMWK(
                  (parseFloat(mPrice.replace(/,/g, '')) || 0) *
                    (parseInt(mQty.replace(/[^0-9]/g, ''), 10) || 1)
                )}
              </Text>
 
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { flex: 1 }]}
                  onPress={() => setManualOpen(false)}
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, { flex: 1.5 }]} onPress={submitManual}>
                  <Text style={styles.primaryBtnText}>Add to list</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }
 
  function renderProducts() {
    const list = Object.keys(products)
      .map((code) => ({ code, ...products[code] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return (
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12 }}
        data={list}
        keyExtractor={(p) => p.code}
        ListHeaderComponent={
          <Text style={styles.productsHelp}>
            Products the app remembers. Tap one to change its price or name.
          </Text>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No products yet. Scan a barcode to teach the app.</Text>
        }
        renderItem={({ item: p }) => (
          <TouchableOpacity style={styles.card} onPress={() => openEdit(p.code)}>
            <View style={styles.cardRow}>
              <Text style={[styles.cardMeta, { flex: 1 }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={styles.cardTotal}>{formatMWK(p.price)}</Text>
            </View>
            <Text style={styles.cardDate}>Code {p.code}</Text>
          </TouchableOpacity>
        )}
      />
    );
  }

  function renderHistory() {
    return (
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12 }}
        data={history}
        keyExtractor={(h) => h.id}
        ListEmptyComponent={<Text style={styles.empty}>No saved lists yet.</Text>}
        renderItem={({ item: h }) => {
          const open = expandedId === h.id;
          const n = countUnits(h.items);
          return (
            <View style={styles.card}>
              <TouchableOpacity onPress={() => setExpandedId(open ? null : h.id)}>
                <Text style={styles.cardDate}>{formatDate(h.date)}</Text>
                <View style={styles.cardRow}>
                  <Text style={styles.cardMeta}>
                    {n} item{n === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.cardTotal}>{formatMWK(h.total)}</Text>
                </View>
              </TouchableOpacity>
              {open && (
                <View style={{ marginTop: 8 }}>
                  {h.items.map((i) => (
                    <View key={i.id} style={styles.detailRow}>
                      <Text style={styles.detailName} numberOfLines={1}>
                        {i.name}
                        {qtyOf(i) > 1 ? `  × ${qtyOf(i)}` : ''}
                      </Text>
                      <Text style={styles.detailPrice}>{formatMWK(lineTotal(i))}</Text>
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => deleteHistory(h.id)}>
                    <Text style={styles.deleteText}>Delete this list</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />
    );
  }
 
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={DARK} />
      <View style={styles.header}>
        <Text style={styles.title}>Net-Pro Label Scan</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'scan' ? renderScan() : tab === 'products' ? renderProducts() : renderHistory()}
      </View>

      {/* New barcode (learn) / edit product form */}
      <Modal visible={learnOpen} transparent animationType="slide" onRequestClose={() => closeLearn(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {learnMode === 'learn' ? 'New barcode' : learnMode === 'label' ? 'Check label' : 'Edit product'}
            </Text>
            {learnMode === 'label' ? (
              <Text style={styles.codeText}>
                The camera can misread digits. Check the name and price.
              </Text>
            ) : null}
            {learnCode ? (
              <Text style={styles.codeText}>
                Barcode: {learnCode}
                {learnMode === 'label' ? (
                  <Text style={styles.linkText} onPress={() => setLearnCode('')}>
                    {'   '}Not this item
                  </Text>
                ) : null}
              </Text>
            ) : learnMode === 'label' ? (
              <Text style={styles.codeText}>No barcode attached - this item will not be remembered.</Text>
            ) : null}
            {lNote ? <Text style={styles.noteText}>{lNote}</Text> : null}

            <Text style={styles.fieldLabel}>Item name</Text>
            <TextInput
              style={styles.field}
              value={lName}
              onChangeText={setLName}
              placeholder="e.g. Safari Peanuts & Raisins"
              placeholderTextColor="#9ca3af"
              autoFocus
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 2 }}>
                <Text style={styles.fieldLabel}>Price (MWK)</Text>
                <TextInput
                  style={styles.field}
                  value={lPrice}
                  onChangeText={setLPrice}
                  placeholder="e.g. 4160"
                  placeholderTextColor="#9ca3af"
                  keyboardType="decimal-pad"
                />
              </View>
              {learnMode !== 'edit' ? (
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Quantity</Text>
                  <TextInput
                    style={styles.field}
                    value={lQty}
                    onChangeText={setLQty}
                    keyboardType="number-pad"
                    maxLength={4}
                    selectTextOnFocus
                  />
                </View>
              ) : null}
            </View>

            {learnMode !== 'edit' ? (
              <Text style={styles.sheetTotal}>
                Line total:{' '}
                {formatMWK(
                  (parseFloat(lPrice.replace(/,/g, '')) || 0) *
                    (parseInt(lQty.replace(/[^0-9]/g, ''), 10) || 1)
                )}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => closeLearn(false)}>
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1.5 }]} onPress={submitLearn}>
                <Text style={styles.primaryBtnText}>
                  {learnMode === 'edit' ? 'Save changes' : learnCode ? 'Save & add' : 'Add to list'}
                </Text>
              </TouchableOpacity>
            </View>
            {learnMode === 'learn' && Platform.OS !== 'web' ? (
              <TouchableOpacity style={styles.readInstead} onPress={readLabelForCode}>
                <Text style={styles.readInsteadText}>📷  Read the label with the camera instead</Text>
              </TouchableOpacity>
            ) : null}
            {learnMode === 'edit' ? (
              <TouchableOpacity onPress={deleteProduct}>
                <Text style={styles.deleteText}>Forget this product</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'scan' && styles.tabActiveBox]}
          onPress={() => setTab('scan')}
        >
          <Text style={[styles.tabText, tab === 'scan' && styles.tabActive]}>Scan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'products' && styles.tabActiveBox]}
          onPress={() => setTab('products')}
        >
          <Text style={[styles.tabText, tab === 'products' && styles.tabActive]}>
            Products ({Object.keys(products).length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'history' && styles.tabActiveBox]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabActive]}>
            History ({history.length})
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
 
// ---------- styles ----------
 
const DARK = '#374151'; // main charcoal
const GRAY = '#9ca3af'; // scan corners (use '#d1d5db' if hard to see)
const OK = '#16a34a';
const ERR = '#dc2626';
 
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingTop: StatusBar.currentHeight || 0,
    // on a laptop browser keep the app phone-shaped and centred
    ...(Platform.OS === 'web' ? { width: '100%', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' } : {}),
  },
  header: { backgroundColor: DARK, paddingVertical: 14, alignItems: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  permText: { fontSize: 16, textAlign: 'center', marginBottom: 16, color: '#111827' },
 
  // camera + frame  (change frame width/height to resize the scan box)
  cameraWrap: {
    height: 260,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: 'hidden',
  },
  frame: { width: 230, height: 120 }, // wide enough for barcodes as well as QR codes
  corner: { position: 'absolute', width: 36, height: 36, borderColor: GRAY },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
 
  // shown instead of the camera when camera access is off
  noCamera: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 30 },
  noCameraText: { color: '#fff', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  allowBtn: { backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 10 },
  allowBtnText: { color: DARK, fontSize: 15, fontWeight: '700' },
  noCameraSub: { color: '#9ca3af', fontSize: 13, marginTop: 12, textAlign: 'center' },

  // hint label on top of the camera
  hint: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(17,24,39,0.65)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  hintOk: { backgroundColor: OK },
  hintError: { backgroundColor: ERR },
  hintText: { color: '#fff', fontSize: 14, fontWeight: '600' },
 
  // total card
  totalCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  totalLabel: { fontSize: 12, color: '#6b7280', letterSpacing: 1 },
  totalValue: { fontSize: 38, fontWeight: '800', color: DARK, marginTop: 2 },
 
  // item rows (name on top, price / quantity / line total underneath)
  row: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 8,
    paddingLeft: 14,
    paddingBottom: 10,
    borderRadius: 10,
    elevation: 1,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600', paddingVertical: 10, color: '#111827' },
  removeBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  removeText: { color: ERR, fontSize: 16 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', paddingRight: 14 },
  unitPrice: { flex: 1, fontSize: 13, color: '#6b7280' },
  stepper: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 20, fontWeight: '700', color: DARK, lineHeight: 22 },
  qtyInput: {
    width: 52,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    paddingVertical: 0,
  },
  rowPrice: { fontSize: 16, fontWeight: '800', color: DARK, minWidth: 90, textAlign: 'right' },
  empty: { textAlign: 'center', color: '#9ca3af', marginTop: 28, fontSize: 15, paddingHorizontal: 20 },
 
  // buttons
  actions: { flexDirection: 'row', padding: 12, gap: 10, backgroundColor: '#fff' },
  primaryBtn: {
    backgroundColor: DARK,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
  secondaryBtn: {
    backgroundColor: '#e5e7eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#111827', fontSize: 16, fontWeight: '600' },
 
  // manual entry sheet
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    padding: 18,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: DARK, marginBottom: 12 },
  fieldLabel: { fontSize: 13, color: '#6b7280', marginBottom: 4, marginTop: 6 },
  field: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  sheetTotal: { fontSize: 15, fontWeight: '700', color: DARK, marginTop: 12 },
 
  readBtn: {
    position: 'absolute',
    top: 10,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  readBtnText: { color: DARK, fontSize: 14, fontWeight: '700' },
  readInstead: { alignItems: 'center', paddingVertical: 14 },
  readInsteadText: { color: DARK, fontSize: 15, fontWeight: '600' },
  linkText: { color: '#2563eb', fontWeight: '700' },
  noteText: { fontSize: 13, color: '#b45309', marginBottom: 4 },
  codeText: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  productsHelp: { fontSize: 13, color: '#6b7280', marginBottom: 10, textAlign: 'center' },

  // history
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
  },
  cardDate: { fontSize: 14, color: '#6b7280' },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  cardMeta: { fontSize: 15, color: '#374151' },
  cardTotal: { fontSize: 18, fontWeight: '700', color: DARK },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailName: { flex: 1, fontSize: 15, color: '#111827' },
  detailPrice: { fontSize: 15, fontWeight: '600', color: DARK },
  deleteText: { color: ERR, marginTop: 10, fontWeight: '600' },
 
  // tab bar
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderTopWidth: 3, borderTopColor: 'transparent' },
  tabActiveBox: { borderTopColor: DARK },
  tabText: { fontSize: 15, color: '#9ca3af', fontWeight: '600' },
  tabActive: { color: DARK, fontWeight: '800' },
});