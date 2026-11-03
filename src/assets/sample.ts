/**
 * 內建範例插畫（程式繪製，無外部檔案）：
 * 淡黃圓點背景、白色貼紙描邊、橘子漸層身體、綠葉與深色莖、黑眼睛、紅色福袋、金元寶、金色「開工大吉」。
 */
export function drawSample(): HTMLCanvasElement {
  const S = 1000;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  // 背景 + 圓點
  g.fillStyle = '#FFF4C9';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#FBE08E';
  for (let y = 40; y < S; y += 90)
    for (let x = (y / 90) % 2 ? 85 : 40; x < S; x += 90) { g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); }

  // 白色貼紙描邊（整個角色外擴）
  const silhouette = (pad: number) => {
    g.beginPath(); g.arc(470, 560, 270 + pad, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(560, 255, 95 + pad, 45 + pad, -0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.roundRect(690 - pad, 600 - pad, 190 + pad * 2, 230 + pad * 2, 60 + pad); g.fill();
  };
  g.fillStyle = '#FFFFFF';
  silhouette(26);

  // 橘子身體：放射漸層（測試「漸層合併為單一色層」）
  const grd = g.createRadialGradient(400, 470, 30, 470, 560, 290);
  grd.addColorStop(0, '#FFB054');
  grd.addColorStop(1, '#F27A1A');
  g.fillStyle = grd;
  g.beginPath(); g.arc(470, 560, 270, 0, Math.PI * 2); g.fill();

  // 莖與葉
  g.fillStyle = '#5A3418';
  g.beginPath(); g.roundRect(455, 255, 26, 70, 10); g.fill();
  g.fillStyle = '#3FA34D';
  g.beginPath(); g.ellipse(560, 255, 95, 45, -0.5, 0, Math.PI * 2); g.fill();

  // 眼睛（小面積高對比，需被保留）
  g.fillStyle = '#1B1B1B';
  for (const x of [385, 545]) { g.beginPath(); g.ellipse(x, 560, 20, 27, 0, 0, Math.PI * 2); g.fill(); }
  // 腮紅
  g.fillStyle = '#F2575F';
  for (const x of [335, 600]) { g.beginPath(); g.ellipse(x, 620, 32, 18, 0, 0, Math.PI * 2); g.fill(); }

  // 紅色福袋
  g.fillStyle = '#D7263D';
  g.beginPath(); g.roundRect(690, 600, 190, 230, 60); g.fill();
  g.fillStyle = '#F2C230';
  g.fillRect(690, 650, 190, 22);
  g.font = 'bold 90px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('福', 785, 750);

  // 金元寶
  g.beginPath();
  g.moveTo(140, 820); g.quadraticCurveTo(160, 900, 260, 900); g.quadraticCurveTo(360, 900, 380, 820);
  g.quadraticCurveTo(330, 850, 260, 850); g.quadraticCurveTo(190, 850, 140, 820); g.fill();
  g.beginPath(); g.ellipse(260, 830, 50, 36, 0, Math.PI, 0); g.fill();

  // 文字「開工大吉」（含細筆畫與封閉孔，用來測試過細標紅）
  g.font = 'bold 130px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
  g.lineJoin = 'round';
  g.strokeStyle = '#FFFFFF'; g.lineWidth = 26;
  g.strokeText('開工大吉', 500, 125);
  g.fillStyle = '#E3A21A';
  g.fillText('開工大吉', 500, 125);
  return c;
}
