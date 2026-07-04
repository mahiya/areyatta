# AREYATTA?

毎日のルーチンタスクを実行したかどうか（あれやった？）をチェックして、習慣化を支援する PWA アプリです。
HTML / CSS / JavaScript のみで動作するスタンドアロン構成で、データはブラウザの Local Storage に保存されます。

## 機能

- タスクの登録（タイトル・アイコン・週に何日以上やるかの目標）
- トップ画面
  - タスク一覧と過去7日分の達成状況を表示
  - 日付セルを長押しすると、その日のチェックを付けたり外したりできる（過去7日分まで修正可能）
  - 今週（月曜始まり）の目標に対する進捗を表示
  - タスクの編集・削除・並び替え
- タスク詳細画面
  - 達成率（実行日数 ÷ 記録開始からの経過日数）
  - 現在の連続日数 / 最長の連続日数
  - GitHub 風の実行ヒートマップ（過去1年分）
- データの JSON エクスポート / インポート
- PWA 対応（ホーム画面への追加、オフライン動作）

## 使い方

Service Worker を使用するため、HTTPS 環境または localhost で動かします。

### GitHub Pages で公開する

このリポジトリはそのまま GitHub Pages で公開できます（全アセットを相対パスで参照しているため、サブパス配下でも動作します）。

1. GitHub のリポジトリページで Settings → Pages を開く
2. Source を "Deploy from a branch"、Branch を `main` / `/ (root)` にして Save
3. 数分後に `https://<ユーザー名>.github.io/areyatta/` で公開されます

スマートフォンでこの URL を開き、「ホーム画面に追加」するとアプリとして利用できます。

### ローカルで動かす

```
python -m http.server 8000
```

を実行して `http://localhost:8000` を開いてください。

## ファイル構成

```
index.html     アプリ本体の HTML
style.css      スタイルシート（ダークテーマ）
app.js         アプリケーションロジック
sw.js          Service Worker（オフラインキャッシュ）
manifest.json  PWA マニフェスト
icons/         アプリアイコン
```

## データ形式

Local Storage のキー `areyatta:v1` に以下の形式で保存されます。エクスポートされる JSON も同じ構造です。

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "uuid",
      "title": "筋トレ",
      "icon": "💪",
      "weeklyGoal": 3,
      "createdAt": "2026-07-04",
      "checks": { "2026-07-03": true, "2026-07-04": true },
      "order": 0
    }
  ]
}
```
