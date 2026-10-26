# OWEditor

独自の編集エンジンを持つ、組み込み用HTMLエディター。日本語の操作画面、文字・画像・表の編集、HTML出力を提供する初版プレビューです。

**[機能紹介](https://owjapan.github.io/ow-editor/) · [記事編集デモ](https://owjapan.github.io/ow-editor/demo.html) · [複数フィールドのデモ](https://owjapan.github.io/ow-editor/multiple.html)**

同じJS/CSSを複数サービスで利用できます。ライセンスキーや利用回数の計測処理はありません。編集エンジン・UI・履歴は独自実装し、HTMLの安全化にDOMPurifyを使用しています。Tiptap / ProseMirror / CKEditorは使用しません。

## 使い方

生成済みファイルを読み込むだけなら、Node・Ruby・Railsは不要です。通常script版とES module版を用意しています。

```html
<link rel="stylesheet"
      href="https://owjapan.github.io/ow-editor/releases/0.1.0/ow-editor.css">
<textarea id="body" name="body"><p>記事本文</p></textarea>
<script src="https://owjapan.github.io/ow-editor/releases/0.1.0/ow-editor.js"></script>
<script>
  const editor = new OWEditor.RichTextEditor(document.querySelector('#body'), {
    messages: OWEditor.messages,
    draftKey: 'articles:123:body'
  });
</script>
```

実際の外部配信ではバージョンを固定し、[release.json](docs/releases/0.1.0/release.json)にある各ファイルの`integrity`値と`crossorigin="anonymous"`をscript/linkへ設定してください。同じファイルを自分のサービス内へコピーして配信することもできます。

### 画像APIを接続する

画像追加は利用するサービス側から`upload`関数を渡す方式です。未指定なら画像追加ボタンは無効になり、既定のAPIへ接続することはありません。保存後の画像URLはHTTP/HTTPSまたは相対パスで返します。

```javascript
const editor = new OWEditor.RichTextEditor(document.querySelector('#body'), {
  messages: OWEditor.messages,
  draftKey: `articles:${articleId}:body`,
  upload: async (file, { signal }) => {
    const body = new FormData(); body.append('image', file);
    const response = await fetch('/your-image-api', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'X-CSRF-Token': csrfToken }, body
    });
    if (!response.ok) throw new Error('画像の保存に失敗しました。');
    return (await response.json()).url;
  }
});
```

`articleId`・`csrfToken`・APIのURLと応答形式は利用するサービスで用意します。認証・CSRF・ファイルの実体とサイズの検査・保存権限は、そのサービスのサーバーで確認してください。アップロード関数は中断用`signal`を扱ってください。

### 本文を保存する

通常のフォームでは、本文を元のtextareaへ同期します。同じフォームに複数エディターを置く場合も、全員の状態を確認して送信を制御します。独自の保存APIを呼ぶ場合は、`canSave`を確認し、保存成功後に`markSaved()`を呼びます。

```javascript
editor.getHTML();     // 未編集なら元のHTMLをそのまま返す保存用API
editor.getSafeHTML(); // 安全化済みHTML。表示にもサーバー側の安全化を推奨
editor.canSave;       // パネル編集中・画像送信中・IME変換中・破棄後はfalse
editor.dirty;         // 未保存の変更があるか
editor.markSaved();   // 保存成功後に呼ぶ。下書きとdirtyをクリア
editor.destroy();     // リスナーとUIを破棄し、textareaとボタンを元状態に戻す
```

`onChange(editor)`・`onStateChange(editor)`・`onSubmit(editor)`で利用先のUIや保存処理と連携できます。元から無効だった送信ボタンは維持します。エディター初期化後の有効化を委ねる場合だけ`enableInitiallyDisabledSubmit: true`を指定してください。

下書きは同じブラウザー・タブのsessionStorage内に置きます。元の保存済み本文が変わっていれば無断復旧しません。`draftKey`には利用者・記事・フィールドなど、サービスに必要な区別を含めてください。

### ES module

CSSは共通です。生成済みmoduleにはDOMPurifyも同梱しています。

```javascript
import { RichTextEditor, messages, VERSION }
  from 'https://owjapan.github.io/ow-editor/releases/0.1.0/ow-editor.mjs';
const editor = new RichTextEditor(document.querySelector('#body'), { messages });
```

## 機能

| 分類 | 初版の対応 |
| --- | --- |
| 文字 | 太字・斜体・下線・取消線、書体・サイズ・色・背景色、書式解除 |
| 段落 | 見出し、リストと階層、字下げ、配置、引用、水平線 |
| リンク | Web・メール・電話、別タブ設定、編集・解除 |
| 画像 | upload関数による追加、幅・高さ・配置・代替テキスト・キャプション、幅スライダー |
| 表 | 行列追加/削除、セル結合/分割、見出し、背景・枠線・幅・配置 |
| 編集補助 | Undo/Redo、検索/置換、HTMLソース適用/取消/プレビュー、全画面、文字数 |
| 保存制御 | タブ内下書き、複数フィールドの保存可否、画像送信/IME変換中の保存防止 |

サンプルの「HTMLダウンロード」はローカルファイルとして保存します。サンプル画像は同じ静的サイトの画像です。記事編集デモにファイル送信APIはありません。複数フィールドのデモは表示の更新だけを行います。

## 開発

Node 24を使用します。Ruby・Rails・DB・秘密情報は不要です。

```bash
git clone https://github.com/owjapan/ow-editor.git
cd ow-editor
npm ci --ignore-scripts
npm test
npm run build
npm run serve
```

`http://127.0.0.1:4173/`で紹介・サンプルを表示します。

- `src/`: 編集エンジン・文書モデル・UI・HTML安全化・日本語翻訳
- `styles/`: 共通CSSのSCSSソース
- `scripts/`: Nodeだけで動くビルドとローカルサーバー
- `test/`: 独立したJavaScript試験とブラウザー試験
- `docs/`: GitHub Pages用の機能紹介・サンプル・版ごとの配布物
- `dist/`: ローカルビルド結果（Git対象外）

`npm run build -- --check`は、ソースからの生成物とコミット済み配布物が一致するか検査します。公開済みの版を更新する場合は、新しいバージョンへ変更して生成してください。

ブラウザー試験は`CHROME_BIN=/path/to/chrome npm run test:browser`で実行します。Linux Chromium/Chromeで確認し、独立したloopbackサーバーと架空の本文だけを使用します。

## 初版の範囲

- Chromiumを自動試験の対象としています。Safari/iOS、Android、macOSの実IMEは追加確認が必要です。
- 共同編集、校閲、Word/PDFの完全変換、画像や列境界を直接つかむドラッグUIは未実装です。
- 任意のHTMLの完全な往復変換は保証しません。編集後は対応する構造・属性・CSSへ正規化します。未編集の保存用HTMLは保持します。
- 本文はUTF-8で2MiB、構造20,000ノード/100階層、表100行/100列まで。履歴は最大100状態・概算5MiBです。
- 標準画像形式はJPEG/PNG/GIF/WebP、10MiBまで。利用先は`allowedImageTypes`・`maxImageBytes`で制限できます。
- UIは`df-editor`接頭辞のCSSを使用します。Shadow DOMによる完全なCSS隔離はありません。CSPでstyle属性を禁止する場合は別途互換確認が必要です。

## 配信・公開範囲

GitHub Pagesは`main`の`docs/`を配信します。リポジトリをPrivateへ変更する場合は、Pagesと読み込み元サービスの状態も確認してください。公開中に取得されたコピーや公開forkは回収できません。[GitHubの公開範囲に関する説明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。

独自コードの公開は、現時点でオープンソースライセンスの付与を意味しません。npmへの公開も行っていません。HTML安全化ライブラリのライセンスは[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)と版ごとの`DOMPurify-LICENSE.txt`を参照してください。
