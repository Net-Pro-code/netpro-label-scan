import { parseLabel, parsePrice } from './parseLabel.js';
let fail = 0;
const eq = (a, b, label) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'ok  ' : 'FAIL', label, ok ? '' : JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
// prices as Tesseract actually produced them from the photos
for (const [raw, want] of [['12,100.00',12100],['2,550.00',2550],['4160',4160],['2.550 .00',2550],['2,000.00',2000],['13,750.00',13750],['. 4160',4160],['2.55',2.55],['2,550',2550],['abc',null],['0',null]])
  eq(parsePrice(raw), want, 'price ' + raw);
const t = (lines, want, label, h) => { const r = parseLabel(lines, h); eq({ name: r.name, price: r.price }, want, label); };
t(['i ™ pin','KIKITCHEN WILD MOUN HONEY 901','MK 12,100.00','AM AMA |'], { name: 'Kikitchen Wild Moun Honey 901', price: 12100 }, 'honey crop');
t(['>a V8','KIKITCHEN WILD MOUN HONEY 500G','MK 12,100.00','0 2'], { name: 'Kikitchen Wild Moun Honey 500g', price: 12100 }, 'honey');
t(['[|Satari Peanuts &','aisins Lightly $ 15','> | MK 4160','LUAMIMAOUA AION OAR AT Mc'], { name: 'Satari Peanuts & aisins Lightly $ 15', price: 4160 }, 'safari (messy)');
t(['5|Safari Peanuts &','Raisins Lightly S 15','» MK. 4160'], { name: 'Safari Peanuts & Raisins Lightly S 15', price: 4160 }, 'safari clean');
t(['BA BicTREE BINTO BBQ SPICE - 55G i','MK 2.550 .00 *'], { name: 'BA BicTREE BINTO BBQ SPICE - 55G i', price: 2550 }, 'bbq (messy)');
t(['NYANJA CHILLI SAUCE PIRI -PIRI HO','MK 2,000.00','WN 0 VANTIN'], { name: 'Nyanja Chilli Sauce Piri -Piri Ho', price: 2000 }, 'nyanja');
t(['SPERCORNE! ae PEPPER','| JA. ROBERTSONS PEPPERCORN GRINDE!','MK 13,750.00','{\\CKEN . CHICKEN'], { name: 'Ja. Robertsons Peppercorn Grinde', price: 13750 }, 'robertsons');
// two labels in one photo: pick the one nearest the middle
t([{text:'OTHER ITEM ONE',top:100,height:30},{text:'MK 999.00',top:140,height:30},{text:'MIDDLE ITEM NAME',top:480,height:30},{text:'MK 1,500.00',top:520,height:30}], { name: 'Middle Item Name', price: 1500 }, 'two labels', 1000);
t([{text:'FAR ITEM',top:100,height:20},{text:'MK 999.00',top:130,height:22},{text:'NEAR ITEM NAME',top:500,height:40},{text:'MK 1,500.00',top:545,height:55}], { name: 'Near Item Name', price: 1500 }, 'bigger text wins', 1000);
// with positions (what the phone gives): 2-line name kept, bottle text far above ignored
t([{text:'BLACK PEPPERCORNS',top:100,height:40},{text:'Safari Peanuts &',top:500,height:40},{text:'Raisins Lightly S 15',top:545,height:25},{text:'MK 4160',top:590,height:55}], { name: 'Safari Peanuts & Raisins Lightly S 15', price: 4160 }, 'positions: safari', 1000);
t([{text:'CHICKEN SPICE',top:300,height:40},{text:'BIGTREE BINTO BBQ SPICE - 55G',top:600,height:40},{text:'MK 2,550.00',top:650,height:45}], { name: 'Bigtree Binto Bbq Spice - 55g', price: 2550 }, 'positions: bbq', 1000);
// no MK found
const r = parseLabel(['BIGTREE BINTO BBQ SPICE', 'blurry']); eq([r.price, r.ok], [null, false], 'no price -> not ok');
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
