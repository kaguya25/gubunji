# ぐぶんじ

PCのChromeで、開いたグラブルの結果画面からドロップ・ダメージを記録する拡張です。記録は端末のIndexedDBに保存し、Supabaseにログインすると専用DBへ同期できます。

**v0.1 は実画面の読み取り設定を検証するための初期版です。現在のグラブル画面での取得は未検証です。** ドロップの初期セレクターは参考記事に基づく候補です。キャラ別ダメージは設定画面で実際のDOMに合わせる必要があります。

## インストール

1. Node.js 24以降で `npm ci` → `npm run build` を実行。
2. Chromeで `chrome://extensions/` を開き、「デベロッパーモード」をON。
3. 「パッケージ化されていない拡張機能を読み込む」で、このリポジトリの `dist` フォルダーを指定。
4. グラブルを開いているタブを再読み込みし、拡張をピン留め。
5. 拡張の「履歴と火力を見る」から記録画面を開く。

ビルド済みZIPを使う場合は展開し、`manifest.json` があるフォルダーを指定します。更新時は拡張を削除せず、同じフォルダーの中身を更新して拡張の再読み込みを行ってください。削除すると端末の記録も消えるため、先にJSONでバックアップしてください。

## 使い方

- 普段どおりプレイしてリザルトを開くと、表示情報を自動記録します。
- 同じマルチのリザルト・詳細は戦闘ID候補でまとめ、ドロップを二重加算しません。ソロ等でIDがない記録は重複の可能性を表示します。
- 読めない数量・ダメージは「未取得」。未検証の記録は獲得率の集計対象にしません。
- キャラ別火力は、利用者がゲームのダメージログを開いた時に記録します。拡張はゲームの操作や画面遷移を行いません。
- 「サンプルを見る」で架空のデータによる画面確認ができます。サンプルは別の端末領域に置き、送信しません。
- CSV出力、JSONバックアップ・復元に対応。CSVには数式対策を入れています。

## Supabase

1. 専用プロジェクトを用意し、`supabase/migrations/` の初期SQLを適用。
2. Supabase AuthのEmailプロバイダーを利用。ゲームのログインとは別のアカウントです。
3. 拡張の「設定と保存先」にProject URL、`sb_publishable_` で始まるPublishable key、プロフィール（既定値 `main`）を入力。
4. 「接続先を保存」で、そのSupabaseプロジェクトへの通信権限を許可。
5. 新規登録 → メール確認 → この拡張からログイン。すでに記録用アカウントがある場合はログイン。
6. 未ログイン中の記録も送りたい場合は「未ログイン中の記録をこの保存先へ移行」を実行。

秘密キー・service_role・DBパスワードは使いません。Authセッションは拡張のIndexedDBに保存し、ゲームページには渡しません。アカウント・プロジェクト・プロフィールごとに端末保存と送信待ちを分けます。

`gbf_profiles` と `gbf_observations` はRLSを有効にし、ログイン本人だけが読み書きできます。観測データは変更不可の履歴として保存。RPCは再送時に同じ操作IDと内容を照合します。プロフィールの行ロックでDB保存順を直列化し、変更取得用カーソルの取りこぼしを防ぎます。観測からドロップ・火力の表示用データを再構築します。

未送信記録は通信失敗後も保持。DBが保存を確定した後だけ送信待ちを消します。恒久エラーは自動再送を止め、「今すぐ同期」で再試行できます。ブラウザーを終了している間は同期できません。

## 読み取り設定の確認

1. リザルトを開き、拡張のメニューで「この画面を診断」。診断JSONはアイテム属性と数量の表示のみを含み、ページHTML全体・Cookie・チャットは出力しません。
2. 画面のアイテム・数量と診断結果を比較。
3. 設定画面のJSONでセレクターを調整。`resultRoot` はアイテムとダメージログの両方を含む結果領域にします。
4. アイテム種類、数量、戦闘IDの対応を確認したら `verified: true` に変更。その後に取得した記録から集計できます。
5. 数量表示がない項目を1個として扱うルールを確認できた場合だけ `implicitOne: true`。

ダメージのセレクターは初期値が空です。`total`（自分の総ダメージ）、`turns`（自分のターン数）、`actor`（キャラ行）、`actorName`、`actorTotal`、`actorNormal`、`actorAbility`、`actorOugi`、`actorOther` にCSSセレクターを指定します。内訳はキャラ行を基準に検索します。キャラIDが表示DOMにない場合はスロットで記録し、要確認を表示します。未取得の項目は空のままにできます。

表示されていないログや宝箱の元の順番は取得しません。空リストだけでは「ドロップ0件」と判定しません。ゲームの画面構造や取得範囲は実際の診断結果で確認してください。

## 開発と検証

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

プレビューは `http://127.0.0.1:5173`。UIとサンプル記録を試せます。ゲームの自動取得・Supabaseのログインは拡張内で利用します。

テストは合成DOM、IndexedDBの互換実装、PGliteのPostgreSQLで実行します。実際のChrome拡張導入・ゲーム画面・Supabase Authの実ログインが成功したという証拠にはなりません。確認結果と残作業は [検証記録](docs/validation.md) を参照。

## 構成

- `src/capture.ts`, `src/content.ts`: 表示DOMの取得、変更の監視。
- `src/core.ts`: 重複整理、情報補完、ドロップ率、キャラ構成比、CSV。
- `src/store.ts`: 観測と送信待ちの同時保存。
- `src/sync.ts`, `src/background.ts`: Supabase Auth、同期、拡張メッセージ。
- `src/app.ts`, `public/`: 履歴、集計、設定画面。
- `supabase/migrations/`: DBとRLS。
- `docs/design.md`: 全体の基本設計。iPhone・編集競合等を含む今後の範囲。

PCを先に実装し、iPhone/Safari、確認済みキャラIDのマスター、編成タグごとの比較、編集・削除と競合解決は次の段階です。初期版には記録の編集・削除を実装していないため、削除同期もありません。

参考: [リザルト収集の実装経験](https://kamuiz.livedoor.blog/archives/27813066.html)、[Chrome Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[Supabase JavaScript](https://supabase.com/docs/reference/javascript/initializing)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
