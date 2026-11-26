import cutImg from '../assets/mode-cut.webp';
import multiImg from '../assets/mode-multi.webp';
import { useT } from '../i18n';
import type { AppMode } from '../lib/types';

/**
 * 製作目的選擇（兩張同尺寸的示意圖卡片）。
 * 預設流程是「先選目的、再上傳圖片」，這時沒有 image；若圖片先到了（貼上、拖曳、範例圖），
 * 就在上方顯示縮圖，選完直接進入工作區。選定後不能回到這裡（只能關閉專案重來）。
 */
export function ModeSelect({ image, onPick }: { image?: string; onPick: (m: AppMode) => void }) {
  const t = useT();
  return (
    <div className="mode-pick">
      {image && <img className="mode-thumb" src={image} alt="" />}
      <h1>{t('modeTitle')}</h1>
      <div className="cards two">
        <button type="button" className="card mode-card" onClick={() => onPick('multi')}>
          <span className="mode-art"><img src={multiImg} alt="" draggable={false} /></span>
          <strong>{t('modeMulti')}</strong>
          <small>{t('modeMultiDesc')}</small>
        </button>
        <button type="button" className="card mode-card" onClick={() => onPick('cut')}>
          <span className="mode-art"><img src={cutImg} alt="" draggable={false} /></span>
          <strong>{t('modeCut')}</strong>
          <small>{t('modeCutDesc')}</small>
        </button>
      </div>
    </div>
  );
}
