import { Editor, Notice } from 'obsidian';
import { InsertMode } from './types';

export class TranscriptInserter {
  insert(editor: Editor, text: string, mode: InsertMode): void {
    if (!text) {
      new Notice('Nothing transcribed — try speaking louder or closer to the mic');
      return;
    }

    switch (mode) {
      case 'cursor':
        this.insertAtCursor(editor, text);
        break;
      case 'newline':
        this.insertOnNewline(editor, text);
        break;
      case 'blockquote':
        this.insertAsBlockquote(editor, text);
        break;
    }
  }

  private insertAtCursor(editor: Editor, text: string): void {
    editor.replaceSelection(text);
    const cursor = editor.getCursor();
    editor.setCursor(cursor);
  }

  private insertOnNewline(editor: Editor, text: string): void {
    const cursor = editor.getCursor();
    const lineLength = editor.getLine(cursor.line).length;
    editor.setCursor({ line: cursor.line, ch: lineLength });
    editor.replaceSelection('\n' + text);
    const newCursor = editor.getCursor();
    editor.setCursor(newCursor);
  }

  private insertAsBlockquote(editor: Editor, text: string): void {
    const cursor = editor.getCursor();
    const lineLength = editor.getLine(cursor.line).length;
    editor.setCursor({ line: cursor.line, ch: lineLength });
    const callout = '\n> [!quote] Transcription\n> ' + text;
    editor.replaceSelection(callout);
    const newCursor = editor.getCursor();
    editor.setCursor(newCursor);
  }
}
