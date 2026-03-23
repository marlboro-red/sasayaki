import { Editor, Notice } from 'obsidian';
import { InsertMode } from './types';

export class TranscriptInserter {
  insert(editor: Editor, text: string, mode: InsertMode): void {
    if (!text) {
      new Notice("Nothing transcribed — try speaking louder or closer to the mic");
      return;
    }

    switch (mode) {
      case 'cursor': {
        editor.replaceSelection(text);
        break;
      }
      case 'newline': {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const endPos = { line: cursor.line, ch: line.length };
        editor.replaceRange('\n' + text, endPos);
        editor.setCursor({ line: cursor.line + 1, ch: text.length });
        break;
      }
      case 'blockquote': {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const endPos = { line: cursor.line, ch: line.length };
        const block = `\n> [!quote] Transcription\n> ${text}`;
        editor.replaceRange(block, endPos);
        editor.setCursor({ line: cursor.line + 2, ch: 2 + text.length });
        break;
      }
    }
  }
}
