# github-html-previewer

GitHub 上の HTML ファイルを、ソース表示のままではなく **実際にレンダリングした見た目** で
ローカルにプレビューできる Chrome 拡張（Manifest V3）です。

## 機能

- GitHub の HTML ファイルページ（`https://github.com/{owner}/{repo}/blob/{branch}/.../*.html`）の
  「Code / Blame」トグルの隣に **「🔍 Preview」タブ** を追加
- タブを押すと、**コードが表示されていたその場所** に HTML を iframe でレンダリング
  （もう一度押す、または Code / Blame をクリックすると元のコード表示に戻る）
- 相対パスの CSS / JS / 画像も `<base>` 注入でリポジトリの raw から読み込み
- サンドボックス iframe（`allow-same-origin` なし）で隔離して描画
- ツールバーアイコンのポップアップに HTML を貼り付けて、別タブで直接プレビューも可能

> Code/Blame トグルが見つからない GitHub のレイアウトでは、自動的に右下のフローティングボタンに
> フォールバックします（挙動は同じく、その場でのプレビュー切り替え）。

## インストール（開発版・unpacked）

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリのルートフォルダ（`manifest.json` がある場所）を選択

## 使い方

- **GitHub から**: 任意の `.html` / `.htm` ファイルのページを開き、「Code / Blame」の隣の「🔍 Preview」タブを押すと、その場でレンダリングされます。もう一度押すとコード表示に戻ります。
- **貼り付けから**: ツールバーの拡張アイコンをクリック → テキストエリアに HTML を貼り付け → 「プレビューを開く」（別タブで開きます）。

## セキュリティ

プレビューはサンドボックス化された iframe（`allow-same-origin` なし）で描画されるため、
ページ内スクリプトは拡張や GitHub のセッションにアクセスできません。スクリプトを実行したくない
場合はプレビュー画面のトグルを OFF にしてください。

## 構成

```
manifest.json        # MV3 マニフェスト
src/
  background.js      # content script の依頼で raw を fetch して返す（CORS 回避）
  content.js         # Code/Blame の隣に Preview タブを注入し、その場で iframe 描画
  preview.html/.js   # 貼り付けプレビュー用の別タブ画面（サンドボックス iframe）
  popup.html/.js     # HTML を貼り付けて直接プレビュー
```

> アイコンは未設定です（Chrome のデフォルトアイコンが表示されます）。必要なら `icons/` を追加し
> `manifest.json` の `action.default_icon` / `icons` を設定してください。

## ライセンス

MIT
