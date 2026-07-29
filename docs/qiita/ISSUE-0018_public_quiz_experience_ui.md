# React + Viteでクイズサービスの一般ユーザー向けMVP画面をAPIへ接続する

## はじめに
QuizVerseでは、Flask側に認証・クイズ一覧・詳細・採点・ランキングAPIを先に実装していました。一方、フロントエンドは管理画面とサービス状況ページが中心で、一般ユーザーが実際にクイズへ挑戦する画面は未整備でした。

本記事では、既存のReact + Vite + Tailwind CSS構成を維持しながら、次の一連の体験を実装した内容を整理します。

- 新規登録・ログイン
- クイズ検索
- クイズ詳細
- 回答・採点結果
- 総合ランキング・クイズ別ランキング

## 実装前の課題
既存の `App.jsx` は管理画面とサービス状況ページを担当しており、すでに大きなコンポーネントになっていました。ここへ一般画面まで直接追加すると、責務がさらに混在します。

そこで、初期パスによってルートコンポーネントを分ける方針を採用しました。

```jsx
const pathname = window.location.pathname
const RootApp = pathname === '/status' || pathname.startsWith('/admin')
  ? App
  : PublicQuizApp
```

- 管理画面・サービス状況: 既存 `App`
- 一般ユーザー向け画面: `PublicQuizApp`

大規模なルーター移行を行わず、既存実装への影響を抑えています。

## APIクライアントを分離する
画面コンポーネントから直接 `fetch` を繰り返さず、`frontend/src/public/api.js` に共通処理を集約しました。

担当する処理は次のとおりです。

- JSONリクエスト
- クエリパラメータ生成
- JWT Authorizationヘッダー
- APIエラーの共通化
- 401時のセッションクリア
- 認証・クイズ・ランキングAPIの関数化

```js
async function request(path, { method = 'GET', body, accessToken, query } = {}) {
  // URL、headers、JSON、エラー処理を共通化
}
```

## MVPの認証状態管理
MVPではJWTとユーザー情報を `localStorage` に保存しています。

```txt
quizverse_access_token
quizverse_user
```

アプリ起動時には `GET /api/auth/me` を実行し、保存済みトークンが現在も利用可能か確認します。APIが401を返した場合は認証情報を削除します。

この方式は実装が簡潔ですが、将来的には以下を検討する必要があります。

- HttpOnly Cookie
- refresh token
- CSRF対策
- セッション失効管理

## クイズ一覧と検索
一覧画面ではバックエンドの次の仕様に合わせました。

- `q`: title / descriptionのキーワード検索
- `category`: 完全一致
- `page` / `per_page`: ページング

検索フォームの入力値と、実際にAPIへ送る適用済み条件を分けています。入力中に毎回通信せず、検索ボタンを押した時点で条件を反映できます。

## 回答と採点
クイズ詳細APIでは正答情報が返されません。画面では選択肢IDのみを管理し、回答送信時に次の形式へ変換します。

```json
{
  "answers": [
    {
      "question_id": 1,
      "selected_choice_id": 2
    }
  ]
}
```

採点は必ずサーバー側で行います。未回答問題は送信配列に含めず、バックエンド側で `skipped` として扱います。

結果画面では以下を表示します。

- 正解数
- 不正解数
- 未回答数
- スコア
- 正答率

## ランキング表示
総合ランキングとクイズ別ランキングでは集計定義が異なります。

### 総合
ユーザーごとに各クイズのベストスコアを合計します。

### クイズ別
同一ユーザーのベストプレイのみを採用します。

画面コンポーネントは共通化し、APIと表示項目だけを切り替えています。

## UIで意識したこと
- モバイルでも操作しやすいカード型レイアウト
- skeleton loading
- 空状態
- APIエラー表示
- 回答状況を示すsticky action bar
- ライト / ダーク環境での可読性
- 既存管理画面と同じcyan / indigo系のトーン

## 確認方法
```bash
cd frontend
npm install
npm run build
```

バックエンドと合わせて確認する場合はDocker Composeを利用します。

```bash
docker compose up --build
```

確認対象ルート:

- `/`
- `/signup`
- `/login`
- `/quizzes`
- `/rankings`
- `/status`
- `/admin`

## 今後の改善
- クイズ作成画面
- プロフィール / プレイ履歴
- Google OAuth UI
- OTP入力画面
- React Router導入
- HttpOnly Cookieベース認証
- PlaywrightによるE2Eテスト

## まとめ
APIを先に整備したプロジェクトでも、画面側では認証・ローディング・空状態・エラー状態まで含めて初めて利用可能な体験になります。

既存の管理画面を保ちながら一般画面の責務を分離したことで、今後の画面追加やルーティング移行もしやすい構成になりました。
