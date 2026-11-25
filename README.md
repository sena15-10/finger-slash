# FINGER SLASH

カメラとAIで遊ぶアクションゲームです。カメラ映像はブラウザー内で処理し、録画・送信しません。

## 開発

Node.js をインストールしてから、プロジェクトのフォルダーで実行します。

```sh
npm install
npm run dev
```

本番用ファイルは次のコマンドで `dist/` に作成されます。

```sh
npm run build
npm run preview
npm test
```

Netlify Drop などへ公開するときは、`dist/` の中身をアップロードしてください。カメラを使う場合は HTTPS で開きます。

## ファイル構成

- `index.html` はアプリの起動に必要な最小のHTMLです。
- `src/main.js` はスタイルと画面テンプレートを読み込み、ゲームを起動します。
- `src/config.js` はゲームの調整値を管理し、`src/game/` はモンスター・火の玉攻撃・スコア計算を管理します。
- `src/input/` はカメラとモーション検出、`src/audio/` は効果音とBGMを管理します。
- `src/game/runtime.js` はゲーム進行と画面表示をまとめています。
- `src/view.html` と `src/styles.css` は画面テンプレートとスタイルです。
- `src/game/boss.js` は最後の5秒に出るボスの移動と体力を管理します。
- `assets/` に背景透過の `slime.png`、`ghost.png`、`bat.png`、`golem.png`、`star.png`、`bomb.png`、`fireball.png`、`boss.png` を置くと、対応する絵に差し替わります。

## ボス戦

残り5秒になるとスライムキングが登場します。速い斬りで体力を削りきると500点のボーナスを獲得できます。ボスがいる間、火の玉は出ず、通常モンスターは最大6体です。倒せなかった場合は結果画面に残りHPが表示されます。スタッフメニューでオン・オフでき、URLに `?boss=0` を付けても無効にできます（既定はオン）。

## URL オプション

- `?booth=1` ブース表示
- `?mode=ai`、`?mode=motion`、`?mode=mouse` 操作モード
- `?diff=easy`、`?diff=normal`、`?diff=hard` 難易度
- `?time=30` プレイ時間（10〜180秒）
- `?view=show`、`?view=blur`、`?view=hide` カメラ映像の表示方法
- `?mute=1` 消音、`?assets=0` 画像を無効化、`?attack=0` 火の玉攻撃を無効化
- `?boss=0` ボス戦を無効化
