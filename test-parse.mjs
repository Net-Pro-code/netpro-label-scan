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
t([{text:'CHICKEN SPICE',top:300,height:40},{text:'BIGTREE BINTO BBQ SPICE - 55G',top:600,height:40},{text:'MK 2,550.00',top:650,height:45}], { name: 'Bigtree Binto BBQ Spice - 55g', price: 2550 }, 'positions: bbq', 1000);

// ---- the four newer tags (positions estimated from the photos: left, top, width, height) ----
const L = (text, left, top, width, height) => ({ text, left, top, width, height });
// white tag, "MK: 6695" with a colon; name above the price; barcode digits + date above the name
t([L('6001205731045', 262, 548, 205, 25), L('15-Oct-26', 560, 548, 140, 25), L('MISA B/FAST POR BANANA 1KG', 262, 580, 440, 40), L('MK: 6695', 262, 630, 150, 40),
   L('INSTANT MAIZE PORRIDGE', 330, 20, 420, 50), L('Jungle Oatso Easy', 30, 1150, 330, 60)], { name: 'Misa B/Fast Por Banana 1kg', price: 6695 }, 'tag: ivisa', 1280);
// same tag with the neighbouring tag's text cut off at the left edge, and "MK" read as "MK."
t([L('02', 0, 540, 40, 20), L('LETROOT P', 0, 580, 155, 40), L('6007732034413', 228, 543, 285, 30), L('09/10/2026', 625, 525, 230, 35),
   L('ROLLED OATS GF 500G', 232, 580, 410, 45), L('MK. 15695', 248, 628, 220, 50), L('invegrow', 320, 850, 220, 40)], { name: 'Rolled Oats GF 500g', price: 15695 }, 'tag: oats + neighbour', 1280);
// yellow tag: name (2 lines) LEFT of the price, codes below
t([L('CHAKALAKA RHODES', 328, 660, 145, 16), L('400G, CORN', 328, 678, 80, 16), L('MK 8,499.00', 500, 665, 170, 28),
   L('6005044007071', 538, 698, 135, 14), L('10510668', 335, 735, 72, 14), L('20/10', 580, 745, 45, 14), L('Chakalaka', 30, 270, 220, 50)], { name: 'Chakalaka Rhodes 400g, Corn', price: 8499 }, 'tag: chakalaka (name beside price)', 1280);
t([L('NET MASS', 700, 410, 130, 25), L('30 x 50g', 625, 440, 240, 50), L('TOMATO PASTE POT O', 247, 622, 220, 20), L('GOLD 50G SACHET', 247, 645, 170, 20),
   L('MK 1,749.00', 505, 628, 262, 38), L('6001001612968', 567, 678, 175, 18), L('10212842', 262, 735, 105, 18), L('27/06', 625, 745, 50, 16)], { name: 'Tomato Paste Pot O Gold 50g Sachet', price: 1749 }, 'tag: tomato (name beside price)', 1280);
// "MK" garbled by the reader: still finds the price and says it is a guess
{ const r = parseLabel([L('ROLLED OATS GF 500G', 232, 580, 410, 45), L('We 15695', 248, 628, 220, 50)], 1280);
  eq([r.price, r.guessed, r.name], [15695, true, 'Rolled Oats GF 500g'], 'garbled MK -> price guessed'); }
{ const r = parseLabel([L('6001205731045', 262, 548, 205, 25), L('MISA B/FAST POR BANANA 1KG', 262, 580, 440, 40), L('Mh. 6695', 262, 630, 150, 40)], 1280);
  eq([r.price, r.guessed], [6695, true], 'garbled MK 2'); }
// a barcode number must never be taken for a price
{ const r = parseLabel([L('6001205731045', 262, 548, 205, 25), L('TOMATO PASTE', 262, 580, 300, 40)], 1280);
  eq(r.price, null, 'barcode digits are not a price'); }
// no MK found
const r = parseLabel(['BIGTREE BINTO BBQ SPICE', 'blurry']); eq([r.price, r.ok], [null, false], 'no price -> not ok');
// ---- the four new label photos: positions measured from the pictures ----
const Q = (text, left, top, width, height) => ({ text, left, top, width, height });
const full = (lines, want, label) => { const r = parseLabel(lines, 1280); eq({ name: r.name, price: r.price, code: r.code }, want, label); };
// white dot-matrix label, name above price, "MK:" with a colon
full([Q('6001205731045', 258, 553, 210, 20), Q('15-Oct-26', 560, 553, 145, 22), Q('IVISA B/FAST POR BANANA 1KG', 258, 585, 450, 28), Q('MK: 6695', 262, 630, 150, 32)],
  { name: 'Ivisa B/Fast Por Banana 1kg', price: 6695, code: '6001205731045' }, 'white label: porridge');
// same style, neighbouring label's text to the left must be ignored
full([Q('02 0', 0, 540, 60, 20), Q('LETROOT P', 0, 580, 180, 30), Q('6007732034413', 228, 543, 285, 22), Q('09/10/2026', 625, 543, 230, 24), Q('ROLLED OATS GF 500G', 232, 583, 410, 30), Q('MK: 15695', 247, 630, 220, 35)],
  { name: 'Rolled Oats GF 500g', price: 15695, code: '6007732034413' }, 'white label: oats + neighbour');
// yellow label: name to the LEFT of the price, two lines, barcode number under the price
full([Q('CHAKALAKA RHODES', 328, 663, 142, 14), Q('400G, CORN', 328, 680, 72, 14), Q('MK 8,499.00', 499, 665, 178, 28), Q('6005044007071', 538, 702, 135, 14), Q('10510668', 330, 738, 68, 12), Q('20/10', 580, 750, 45, 14)],
  { name: 'Chakalaka Rhodes 400g, Corn', price: 8499, code: '6005044007071' }, 'yellow label: chakalaka');
full([Q('TOMATO PASTE POT O', 246, 625, 235, 18), Q('GOLD 50G SACHET', 246, 645, 158, 18), Q('MK 1,749.00', 507, 628, 262, 35), Q('6001001612968', 567, 683, 190, 16), Q('10212842', 262, 740, 90, 14), Q('27/06', 625, 750, 55, 14)],
  { name: 'Tomato Paste Pot O Gold 50g Sachet', price: 1749, code: '6001001612968' }, 'yellow label: tomato paste');
// a misread barcode digit must NOT become a code
full([Q('6601205731045', 258, 553, 210, 20), Q('IVISA B/FAST POR BANANA 1KG', 258, 585, 450, 28), Q('MK: 6695', 262, 630, 150, 32)],
  { name: 'Ivisa B/Fast Por Banana 1kg', price: 6695, code: '' }, 'bad check digit -> no code');
// price followed by a date on the same line
t2('MK: 15695 09/10/2026');
function t2(s) { const r = parseLabel(['ROLLED OATS GF 500G', s]); eq(r.price, 15695, 'price before date: ' + s); }
// Code 39 shelf label
{ const r = parseLabel(['K/KITCHEN WILD MOUN HONEY 500G', 'MK 12,100.00', '*800765*']); eq(r.code, '800765', 'code39 star code'); }
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
