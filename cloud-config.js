// 雲端作答紀錄設定（Supabase）。
// 兩個值都填好才會啟用；留空時遊戲照常運作，不會送出任何資料。
//
// url            Supabase 專案網址，例如 https://abcdefghijkl.supabase.co
// publishableKey Supabase 的 publishable key（sb_publishable_ 開頭），這把是公開金鑰，可以放在網頁裡。
//                千萬不要填 secret key（sb_secret_ 開頭）或 service_role key；填了遊戲會拒絕使用。
//
// 設定步驟見 README 的「雲端作答紀錄」。
window.GUARDIAN_CLOUD_CONFIG = {
  url: "",
  publishableKey: "",
};
