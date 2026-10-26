import { Platform } from 'react-native';

// Reads the text in a photo (on the phone, offline, using Google ML Kit).
// Returns lines top-to-bottom: [{ text, top, height, left }]
export async function readTextLines(uri) {
  if (Platform.OS === 'web') {
    throw new Error('Reading labels works in the Android app only.');
  }
  const TextRecognition = require('@react-native-ml-kit/text-recognition').default;
  const result = await TextRecognition.recognize(uri);
  const lines = [];
  (result.blocks || []).forEach((b) =>
    (b.lines || []).forEach((l) =>
      lines.push({
        text: l.text,
        top: l.frame && l.frame.top != null ? l.frame.top : null,
        height: l.frame && l.frame.height != null ? l.frame.height : null,
        left: l.frame && l.frame.left != null ? l.frame.left : null,
        width: l.frame && l.frame.width != null ? l.frame.width : null,
      })
    )
  );
  lines.sort((a, b) => (a.top == null || b.top == null ? 0 : a.top - b.top));
  return lines;
}
