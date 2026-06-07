# github-html-previewer

GitHub 上の HTML ファイルを、ソース表示のままではなく **実際にレンダリングした見た目** で
ローカルにプレビューできる Chrome 拡張（Manifest V3）です。

## 機能

- GitHub の HTML ファイルページ（`https://github.com/{owner}/{repo}/blob/{branch}/.../*.html`）の
  「Code / Blame」トグルの隣に **「Preview(inline)」「Preview(other tab)」** の2つを追加
  - **Preview(inline)**: コードが表示されていたその場所にレンダリング（もう一度押す / Code・Blame で戻る）
  - **Preview(other tab)**: レンダリング結果を別タブで開く
- いずれも拡張のコントローラ + サンドボックスページ経由で描画するため GitHub の CSP の影響を受けない
- HTML ソースは**ページの DOM から直接取得**するため、**プライベートリポジトリでも動作**
  （取得できない場合のみ公開 raw CDN へフォールバック）
- 相対パスの CSS / JS / 画像も `<base>` 注入でリポジトリの raw から読み込み
- **Mermaid などの外部 CDN / インラインスクリプトも実行可能**（緩い CSP のサンドボックスページで描画）
- プレビューはサンドボックス iframe で隔離。スクリプト実行は ON/OFF 切り替え可能
- ツールバーアイコンのポップアップに HTML を貼り付けて、別タブで直接プレビューも可能

> Code/Blame トグルが見つからない GitHub のレイアウトでは、自動的に右下のフローティングボタンに
> フォールバックします（挙動は同じく、別タブでプレビュー）。

## インストール（開発版・unpacked）

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリのルートフォルダ（`manifest.json` がある場所）を選択

## 使い方

- **GitHub から**: 任意の `.html` / `.htm` ファイルのページを開き、「Code / Blame」の隣の「Preview(inline)」または「Preview(other tab)」を押します。
- **貼り付けから**: ツールバーの拡張アイコンをクリック → テキストエリアに HTML を貼り付け → 「プレビューを開く」（別タブで開きます）。

## セキュリティ

プレビューはサンドボックス化された iframe（`allow-same-origin` なし）で描画されるため、
ページ内スクリプトは拡張や GitHub のセッションにアクセスできません。スクリプトを実行したくない
場合はプレビュー画面のトグルを OFF にしてください。

## 構成

```
manifest.json        # MV3 マニフェスト
src/
  background.js              # DOM ソース受領（無ければ公開 raw を fetch）→ 保存して preview タブを開く
  content.js                 # Code/Blame の隣に Preview(inline)/(other tab) を注入。inline は controller を iframe 埋め込み
  preview.html/.js           # コントローラ（別タブ / inline 埋め込み兼用。ツールバー / storage 読み取り / サンドボックスへ受け渡し）
  preview-sandbox.html/.js   # 緩い CSP のサンドボックスページ。受け取った HTML を実行可能な状態で描画
  popup.html/.js             # HTML を貼り付けて直接プレビュー
```

> アイコンは未設定です（Chrome のデフォルトアイコンが表示されます）。必要なら `icons/` を追加し
> `manifest.json` の `action.default_icon` / `icons` を設定してください。

## ライセンス

MIT
