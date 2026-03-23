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
        const textLines = text.split('\n');
        editor.setCursor({ line: cursor.line + textLines.length, ch: textLines[textLines.length - 1].length });
        break;
      }
      case 'blockquote': {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const endPos = { line: cursor.line, ch: line.length };
        const block = `\n> [!quote] Transcription\n> ${text}`;
        editor.replaceRange(block, endPos);
        const textLines = text.split('\n');
        const lastLineLen = textLines.length === 1 ? 2 + textLines[0].length : textLines[textLines.length - 1].length;
        editor.setCursor({ line: cursor.line + 1 + textLines.length, ch: lastLineLen });
        break;
      }
    }
  }
}
