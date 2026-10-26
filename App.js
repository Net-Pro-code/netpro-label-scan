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
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

// food-colour circles with the item's first letter
const AVATARS = ['#E4572E', '#F2A900', '#2D9F5B', '#7B4B94', '#2A7FBA', '#C2410C'];
function avatarColor(name) {
  let h = 0;
  for (let k = 0; k < name.length; k++) h = (h * 31 + name.charCodeAt(k)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
const initialOf = (n) => ((n || '').trim()[0] || '?').toUpperCase();

 
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
  const [lRaw, setLRaw] = useState(''); // what the camera read, for checking
  const [showRaw, setShowRaw] = useState(false);

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
  function showLearn(mode, code, name, price, note, raw) {
    learnOpenRef.current = true;
    setLRaw(raw || '');
    setShowRaw(false);
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
      const pic = await cameraRef.current.takePictureAsync({ quality: 1 });
      const lines = await readTextLines(pic.uri);
      const parsed = parseLabel(lines, pic.height);
      if (!parsed.price) {
        Vibration.vibrate([0, 150, 100, 150]);
        setMessageType('error');
        setMessage('No price found. Move closer so the label fills the frame.');
        return;
      }
      // the barcode number printed on the label (checked), else one scanned a moment ago
      const fresh = Date.now() - pendingCode.current.time < 30000;
      const code = parsed.code ? normalizeCode(parsed.code) : fresh ? pendingCode.current.code : '';
      const saved = code ? products[code] : null;

      // a product the app already knows, at the same price: add it, no form
      if (saved && saved.price === parsed.price && !parsed.guessed) {
        Vibration.vibrate(80);
        addToList({ name: saved.name, price: saved.price }, 1);
        setMessageType('ok');
        setMessage(`Added: ${saved.name}  ${formatMWK(saved.price)}`);
        return;
      }

      Vibration.vibrate(80);
      let note = '';
      if (parsed.guessed) note = 'The "MK" was unclear, so this price is a guess. Check it.';
      else if (saved && saved.price !== parsed.price)
        note = `Saved price was ${formatMWK(saved.price)} - saving will update it.`;
      const raw = lines.map((l) => l.text).join('\n');
      showLearn('label', code, parsed.name, String(parsed.price), note, raw);
    } catch (e) {
      setMessageType('error');
      setMessage('Could not read the label. Try again or use Add item.');
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
        {/* Camera with corner-only frame, status pill and Read label button */}
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
              <Ionicons name="camera-outline" size={34} color="#fff" />
              <Text style={styles.noCameraText}>
                Allow the camera to scan QR codes, barcodes and shelf labels.
              </Text>
              {permission ? (
                <TouchableOpacity style={styles.allowBtn} onPress={requestPermission}>
                  <Text style={styles.allowBtnText}>Allow camera</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.noCameraSub}>You can still use Add item below.</Text>
            </View>
          )}
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
          {cameraReady && Platform.OS !== 'web' ? (
            <TouchableOpacity
              style={[styles.readBtn, busy && styles.btnDisabled]}
              onPress={readLabelPhoto}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator size="small" color={KALE} />
              ) : (
                <Ionicons name="pricetag" size={18} color={KALE} />
              )}
              <Text style={styles.readBtnText}>{busy ? 'Reading label' : 'Read label'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Basket total */}
        <View style={styles.totalCard}>
          <View style={styles.totalTop}>
            <Text style={styles.totalLabel}>Basket total</Text>
            <View style={styles.countChip}>
              <Ionicons name="basket" size={13} color={MANGO} />
              <Text style={styles.countChipText}>
                {units} item{units === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
          <View style={styles.totalMoney}>
            <Text style={styles.cur}>MWK</Text>
            <Text style={styles.totalValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatMWK(total).replace('MWK ', '')}
            </Text>
          </View>
        </View>

        {/* Items */}
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
          data={items}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.emptyIcon}>
                <Ionicons name="basket-outline" size={38} color={LEAF} />
              </View>
              <Text style={styles.emptyTitle}>Your basket is empty</Text>
              <Text style={styles.emptyText}>
                Scan a QR code or barcode, tap Read label on a shelf price, or use Add item.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(item.name) }]}>
                <Text style={styles.avatarText}>{initialOf(item.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.removeBtn}>
                    <Ionicons name="close-circle" size={22} color="#c9d3cc" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.unitPrice}>{formatMWK(item.price)} each</Text>
                <View style={styles.rowBottom}>
                  <View style={styles.stepper}>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => changeQty(item.id, -1)}>
                      <Ionicons name="remove" size={18} color={KALE} />
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
                    <TouchableOpacity
                      style={[styles.stepBtn, styles.stepBtnPlus]}
                      onPress={() => changeQty(item.id, 1)}
                    >
                      <Ionicons name="add" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.rowPrice}>{formatMWK(lineTotal(item))}</Text>
                </View>
              </View>
            </View>
          )}
        />

        {/* Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.ghostBtn, { flex: 1 }]} onPress={clearAll}>
            <Ionicons name="trash-outline" size={18} color={CHILLI} />
            <Text style={styles.ghostBtnText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { flex: 1.3 }]} onPress={openManual}>
            <Ionicons name="add" size={20} color={KALE} />
            <Text style={styles.secondaryBtnText}>Add item</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 1.5 }, items.length === 0 && styles.btnDisabled]}
            onPress={saveList}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
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
          <Text style={styles.empty}>No products yet. Scan a barcode or read a label and the app remembers it.</Text>
        }
        renderItem={({ item: p }) => (
          <TouchableOpacity style={styles.card} onPress={() => openEdit(p.code)} activeOpacity={0.8}>
            <View style={styles.cardLine}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(p.name) }]}>
                <Text style={styles.avatarText}>{initialOf(p.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.cardDate}>Code {p.code}</Text>
              </View>
              <Text style={styles.cardTotal}>{formatMWK(p.price)}</Text>
            </View>
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
        ListEmptyComponent={<Text style={styles.empty}>No saved lists yet. Save a basket and it appears here.</Text>}
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
      <StatusBar barStyle="light-content" backgroundColor={KALE} />
      <View style={styles.header}>
        <View style={styles.mark}>
          <Ionicons name="basket" size={20} color={KALE} />
        </View>
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
            {learnMode === 'label' && lRaw ? (
              <View>
                <Text style={styles.linkText} onPress={() => setShowRaw((v) => !v)}>
                  {showRaw ? 'Hide what the camera read' : 'Show what the camera read'}
                </Text>
                {showRaw ? (
                  <Text style={styles.rawText} numberOfLines={12}>
                    {lRaw}
                  </Text>
                ) : null}
              </View>
            ) : null}

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
                <Ionicons name="pricetag" size={17} color={KALE} />
                <Text style={styles.readInsteadText}>Read the label with the camera instead</Text>
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
        {[
          ['scan', 'scan', 'Scan'],
          ['products', 'pricetags', `Products (${Object.keys(products).length})`],
          ['history', 'time', `History (${history.length})`],
        ].map(([key, icon, label]) => {
          const on = tab === key;
          return (
            <TouchableOpacity key={key} style={styles.tab} onPress={() => setTab(key)} activeOpacity={0.7}>
              <View style={[styles.tabIcon, on && styles.tabIconOn]}>
                <Ionicons name={icon} size={20} color={on ? '#fff' : '#8a9a8f'} />
              </View>
              <Text style={[styles.tabText, on && styles.tabActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
 
// ---------- styles ----------

// Palette: leaf greens for the brand, mango for the one action that matters, chilli for danger
const KALE = '#14452F'; // header, total card
const LEAF = '#2D9F5B'; // primary buttons, active tab
const LEAF_TINT = '#E3F2E7';
const MANGO = '#FFB627'; // Read label
const CHILLI = '#D6402B';
const PAGE = '#F1F6F0';
const INK = '#14231A';
const MUTED = '#6B7A70';
const GRAY = '#d1d5db'; // scan corners
const OK = '#1F8A4C';
const ERR = '#C23A27';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAGE,
    // on a laptop browser keep the app phone-shaped and centred
    ...(Platform.OS === 'web' ? { width: '100%', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' } : {}),
  },
  header: {
    backgroundColor: KALE,
    paddingTop: (StatusBar.currentHeight || 0) + 12,
    paddingBottom: 34, // the camera and total card sit over this edge
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: MANGO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.2 },

  // camera card (overlaps the header)
  cameraWrap: {
    height: 270,
    marginHorizontal: 14,
    marginTop: -26,
    backgroundColor: '#0c1a12',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  frame: { width: 230, height: 120, marginBottom: 26 }, // wide enough for barcodes as well as QR codes
  corner: { position: 'absolute', width: 34, height: 34, borderColor: GRAY },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },

  // shown instead of the camera when camera access is off
  noCamera: { alignItems: 'center', paddingHorizontal: 28 },
  noCameraText: { color: '#fff', fontSize: 15, textAlign: 'center', marginTop: 10, marginBottom: 14 },
  allowBtn: { backgroundColor: MANGO, paddingVertical: 11, paddingHorizontal: 24, borderRadius: 14 },
  allowBtnText: { color: KALE, fontSize: 15, fontWeight: '800' },
  noCameraSub: { color: '#9fb3a6', fontSize: 13, marginTop: 12, textAlign: 'center' },

  // status pill at the top of the camera
  hint: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(10,25,16,0.6)',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
  },
  hintOk: { backgroundColor: OK },
  hintError: { backgroundColor: ERR },
  hintText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // the one bright action: read a shelf label
  readBtn: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: MANGO,
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 26,
    elevation: 4,
  },
  readBtnText: { color: KALE, fontSize: 15, fontWeight: '800' },

  // basket total
  totalCard: {
    backgroundColor: KALE,
    marginHorizontal: 14,
    marginTop: 12,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  totalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, color: '#b9d6c4', fontWeight: '600' },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  countChipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  totalMoney: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 },
  cur: { color: MANGO, fontSize: 18, fontWeight: '800' },
  totalValue: { flex: 1, color: '#fff', fontSize: 42, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // item rows
  row: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 14,
    marginTop: 9,
    paddingLeft: 12,
    paddingVertical: 10,
    borderRadius: 18,
    elevation: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowName: { flex: 1, fontSize: 16, fontWeight: '700', color: INK },
  removeBtn: { paddingHorizontal: 10, paddingVertical: 2 },
  unitPrice: { fontSize: 13, color: MUTED, marginTop: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingRight: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: LEAF_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnPlus: { backgroundColor: LEAF },
  qtyInput: {
    width: 48,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: INK,
    paddingVertical: 0,
  },
  rowPrice: { fontSize: 17, fontWeight: '800', color: KALE, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // empty basket
  emptyBox: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 26 },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: LEAF_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: INK },
  emptyText: { fontSize: 14, color: MUTED, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  empty: { textAlign: 'center', color: MUTED, marginTop: 28, fontSize: 15, paddingHorizontal: 24, lineHeight: 21 },

  // buttons
  actions: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 9, backgroundColor: PAGE },
  primaryBtn: {
    flexDirection: 'row',
    gap: 7,
    backgroundColor: LEAF,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  btnDisabled: { opacity: 0.45 },
  secondaryBtn: {
    flexDirection: 'row',
    gap: 5,
    backgroundColor: LEAF_TINT,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: KALE, fontSize: 16, fontWeight: '700' },
  ghostBtn: {
    flexDirection: 'row',
    gap: 6,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#f0c9c2',
    backgroundColor: '#fff',
  },
  ghostBtnText: { color: CHILLI, fontSize: 15, fontWeight: '700' },

  // pop-up sheets
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(10,25,16,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: INK, marginBottom: 10 },
  fieldLabel: { fontSize: 13, color: MUTED, marginBottom: 4, marginTop: 8, fontWeight: '600' },
  field: {
    borderWidth: 1.5,
    borderColor: '#dbe6de',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: INK,
    backgroundColor: '#f7faf7',
  },
  sheetTotal: { fontSize: 16, fontWeight: '800', color: KALE, marginTop: 14 },
  codeText: { fontSize: 13, color: MUTED, marginBottom: 4 },
  noteText: { fontSize: 13, color: '#b45309', marginBottom: 4, fontWeight: '600' },
  rawText: { fontSize: 12, color: MUTED, backgroundColor: '#f1f5f2', borderRadius: 10, padding: 8, marginTop: 6, marginBottom: 4 },
  linkText: { color: LEAF, fontWeight: '800' },
  readInstead: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: '#FFF3D6',
  },
  readInsteadText: { color: KALE, fontSize: 15, fontWeight: '700' },
  productsHelp: { fontSize: 13, color: MUTED, marginBottom: 10, textAlign: 'center' },

  // products and history cards
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
  },
  cardLine: { flexDirection: 'row', alignItems: 'center' },
  cardName: { fontSize: 16, fontWeight: '700', color: INK },
  cardDate: { fontSize: 13, color: MUTED, marginTop: 1 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  cardMeta: { fontSize: 15, color: INK },
  cardTotal: { fontSize: 17, fontWeight: '800', color: KALE, marginLeft: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  detailName: { flex: 1, fontSize: 15, color: INK },
  detailPrice: { fontSize: 15, fontWeight: '700', color: KALE },
  deleteText: { color: CHILLI, marginTop: 12, fontWeight: '700' },

  // tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingTop: 8,
    paddingBottom: 6,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    elevation: 12,
  },
  tab: { flex: 1, alignItems: 'center' },
  tabIcon: { width: 54, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabIconOn: { backgroundColor: LEAF },
  tabText: { fontSize: 12, color: '#8a9a8f', fontWeight: '600', marginTop: 3 },
  tabActive: { color: KALE, fontWeight: '800' },
});
