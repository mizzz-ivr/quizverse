# Flask + Reactで「プレイ済みユーザーだけレビューできる」クイズ評価機能を実装する

## はじめに

クイズ投稿サービスへ5段階評価を追加するだけなら、`rating`カラムを持つテーブルを作るだけでも動きます。しかし、自己評価・未プレイ評価・非公開コンテンツへの評価まで許可すると、ランキングの信頼性が崩れやすくなります。

QuizVerseではレビューを「実際にプレイしたユーザーのフィードバック」と定義し、DB・API・UIの3層で条件を揃えました。

## DB設計

`quiz_reviews`は`user_id + quiz_id`を複合主キーにしました。

```text
user_id + quiz_id  PRIMARY KEY
rating             INTEGER 1..5
body               TEXT NULL
created_at
updated_at
```

これにより、同一ユーザーが同じクイズへ複数レビューを作ることをDBレベルで防げます。更新は同じ行へのupsertとして扱います。

`rating`はAPIバリデーションだけでなくCheckConstraintでも1〜5に制限しています。

## 投稿条件

PUT時に次を確認します。

1. クイズが`published`
2. 認証ユーザーがactive
3. クイズ作成者本人ではない
4. `quiz_plays`に同一ユーザー・同一クイズの`submitted`が1件以上ある

未プレイなら403 `review/play_required`、作成者なら403 `review/author_not_allowed`を返します。

## 非公開化してもレビューを消さない

クイズが`archived`になったとき、レビュー行自体は削除しません。

公開APIだけ404にすることで、再公開時に評価履歴を復元できます。お気に入り機能と同じ「データ保持と公開可否を分離する」方針です。

## 平均評価を一覧へ付与する

レビュー集計は次の形でクイズ単位にまとめます。

```sql
SELECT
  quiz_id,
  AVG(rating) AS rating_average,
  COUNT(user_id) AS review_count
FROM quiz_reviews
GROUP BY quiz_id;
```

通常の新着一覧は既存処理を維持し、after-request拡張で集計値を付与します。

`sort=rating`だけは評価集計を使った専用クエリで処理します。

並び順は次の通りです。

```text
平均評価 DESC
レビュー件数 DESC
公開日時 DESC
クイズID DESC
```

単純平均はレビュー1件の5.0が上位に来やすいため、本格運用ではベイズ平均やWilson scoreへの変更余地があります。

## React側

既存のクイズ一覧コンポーネントをさらに肥大化させないため、高評価コンテンツは`/top-rated`として独立させました。

クイズ詳細では既存の`QuizDetailSessionGate`より内側にレビュー操作を配置しています。これにより、Cookieセッション確認より先に保護APIが走ることを防ぎます。

レビューDrawerでは次を扱います。

- 平均評価・レビュー件数
- 最新レビュー一覧
- 1〜5星入力
- コメント
- 更新・削除
- 未ログイン導線
- 未プレイ理由
- 作成者の自己評価禁止

## CSRFと認証

一般ユーザー画面はHttpOnly Cookie認証です。

PUT/DELETE時はaccess CSRF Cookieを`X-CSRF-TOKEN`へ設定します。JWT本体はlocalStorageへ保存しません。

## テスト

主に以下を自動化します。

- rating範囲
- コメント長
- 未認証
- inactive user
- 未プレイ
- 自己評価
- 非公開クイズ
- create/update/delete
- 集計値
- ページング
- 高評価順
- 公開一覧・詳細への評価集計
- migration構造
- フロントエンドAPI契約
- 認証ゲートより後でReview UIが描画されること

## まとめ

レビュー機能は投稿フォームより「誰の評価をランキングへ含めるか」が重要です。

QuizVerseでは、プレイ履歴を投稿資格として利用し、複合主キー・公開状態・CSRF・本人スコープを組み合わせて、MVPでも評価値をある程度信頼できる構造にしました。
