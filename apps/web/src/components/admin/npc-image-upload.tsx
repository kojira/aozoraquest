import { useContext, useState } from 'react';
import { NPC_EXPRESSION_NAME, type NpcDef, type NpcImageKind } from '@aozoraquest/core';
import { NpcSprite } from '../npc-sprite';
import { npcImagePreviewKey, NpcImagePreviews, useNpcImageSource } from '../npc-image';
import { npcDialogueLines, npcImageUrl } from '@/lib/npc-image';
import { DialogueWindow } from '../dialogue-window';

export function NpcImageUpload({ npc, canUpload, onFile, onRemove }: {
  npc: NpcDef; canUpload: boolean;
  onFile: (kind: NpcImageKind, file: File, expression?: string) => void;
  onRemove: (kind: NpcImageKind, expression?: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [expression, setExpression] = useState('');
  const previews = useContext(NpcImagePreviews);
  const expressionSrc = (tag: string, image: NonNullable<NpcDef['expressionImages']>[string]) => previews.get(npcImagePreviewKey(npc.id, 'portrait', tag)) ?? npcImageUrl(npc.id, 'portrait', image, tag);
  const expressionValid = NPC_EXPRESSION_NAME.test(expression);
  const portrait = useNpcImageSource(npc.id, 'portrait', npc.portraitImage);
  const choose = (kind: NpcImageKind, title: string) => <label style={{ display: 'block' }}>{title}
    <input aria-label={title} type="file" accept="image/png,image/webp,.png,.webp" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }} disabled={!canUpload} onChange={(e) => {
      const file = e.currentTarget.files?.[0]; e.currentTarget.value = '';
      if (file) onFile(kind, file);
    }} />
  </label>;
  return <section aria-label="NPC画像アップロード" style={{ border: '1px solid var(--color-border)', padding: '0.7em', fontSize: '0.85em', minWidth: 0, overflowWrap: 'anywhere' }}>
    <strong>画像をアップロード</strong>
    {!canUpload && <p role="note">共有NPCの画像をアップロードできるのは主管理者本人だけです。ほかの編集機能は引き続き使えます。</p>}
    <p>入力はPNG・WebP、保存はWebP。透明背景OK。JPEG / GIF / APNG / アニメWebP / SVGは静止PNG・WebPへ変換してください。</p>
    <p>選択だけでは送信しません。「保存」でPDSへ送信し、誰でも見られるゲーム素材として公開します。マップ画像はロスレス、会話イラストは画質を調整してWebPにします。サイズは変えません。元のWebPが小さい場合はそのまま使うため、付加情報も公開される場合があります。変換した画像には元の付加情報をコピーしません。保存失敗時も送信済み画像がPDSに残る場合があり、自動削除はしません。</p>
    <h3 style={{ fontSize: '1em' }}>マップ画像</h3>
    <p>必須: 100KiB以下。静止は16×16 / 32×32px。歩行は横2コマ32×16 / 64×32px（各コマ16×16 / 32×32）。</p>
    <figure style={{ margin: '0.5em 0' }}>
      <div aria-label="歩行シートは左に1コマ目、右に2コマ目" style={{ display: 'flex', width: 'fit-content', border: '1px solid currentColor' }}>
        <span style={{ padding: '0.7em', borderRight: '1px solid currentColor' }}>① 左のコマ</span><span style={{ padding: '0.7em' }}>② 右のコマ</span>
      </div>
      <figcaption>①→②を300msずつ交互に表示。「動きを減らす」設定では①のみ。</figcaption>
    </figure>
    {choose('sprite', 'マップ画像を選ぶ')}
    <svg aria-label="マップ画像プレビュー" viewBox="0 0 32 32" width={96} height={96}><NpcSprite npc={npc} /></svg>
    {npc.spriteImage && <p>{npc.spriteImage.width}×{npc.spriteImage.height}px · {(npc.spriteImage.blob.size / 1024).toFixed(1)}KiB · {npc.spriteImage.width === npc.spriteImage.height ? '静止' : '横2コマ'} <button type="button" onClick={() => onRemove('sprite')}>マップ画像を外す</button></p>}
    <h3 style={{ fontSize: '1em' }}>会話イラスト</h3>
    <p>推奨: 512×768px（縦長）。必須: 各辺1〜1024px・1MiB以下・静止PNG・WebP。縦横比を保って会話窓の上に表示します。</p>
    {choose('portrait', '会話イラストを選ぶ')}
    {portrait && <img src={portrait} alt="会話イラストプレビュー" style={{ display: 'block', maxWidth: '100%', width: 140, height: 160, objectFit: 'contain' }} />}
    {npc.portraitImage && <p>{npc.portraitImage.width}×{npc.portraitImage.height}px · {(npc.portraitImage.blob.size / 1024).toFixed(1)}KiB <button type="button" onClick={() => onRemove('portrait')}>会話イラストを外す</button></p>}
    <h3 style={{ fontSize: '1em' }}>表情別の会話イラスト</h3>
    <p>セリフの先頭に <code>[表情名]</code>（英小文字、例: <code>[sad]</code>）を書くと、その行だけ登録した表情のイラストを出します。表情名は画面に表示しません。未登録の表情名・表情名なしの行は上の会話イラストです。規格は会話イラストと同じです。</p>
    <label style={{ display: 'block' }}>表情名
      <input aria-label="表情名" value={expression} placeholder="sad" onChange={(e) => setExpression(e.currentTarget.value.trim())} />
    </label>
    {expression && !expressionValid && <p role="note">表情名は英小文字だけにしてください</p>}
    <label style={{ display: 'block' }}>表情のイラストを選ぶ
      <input aria-label="表情のイラストを選ぶ" type="file" accept="image/png,image/webp,.png,.webp" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }} disabled={!canUpload || !expressionValid} onChange={(e) => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = '';
        if (file) onFile('portrait', file, expression);
      }} />
    </label>
    {Object.entries(npc.expressionImages ?? {}).map(([tag, image]) => <div key={tag} style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
      <img src={expressionSrc(tag, image)} alt={`表情 ${tag} のプレビュー`} style={{ width: 70, height: 80, objectFit: 'contain' }} />
      <span>[{tag}] {image.width}×{image.height}px · {(image.blob.size / 1024).toFixed(1)}KiB <button type="button" onClick={() => onRemove('portrait', tag)}>表情 {tag} を外す</button></span>
    </div>)}
    <button type="button" onClick={() => setPreview(true)}>会話をプレビュー</button>
    <p>プレビューは保存するWebPです。変換で必ず小さくなるとは限りません。元ファイルは変更しません。</p>
    <p>差し替え・画像を外す操作も未保存です。取り消すには「未保存の変更を取り消す」。元の手描き絵は消しません。</p>
    {preview && <DialogueWindow lines={npcDialogueLines(npc, npc.lines.filter(Boolean), expressionSrc)} portrait={portrait ? { src: portrait, name: npc.name } : undefined} choices={[{ label: 'プレビューを閉じる', onSelect: () => {} }]} onDone={() => setPreview(false)} />}
  </section>;
}
