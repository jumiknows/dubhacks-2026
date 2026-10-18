import { requestJson, stripHtml } from "../core.js";

/**
 * Open Icecat: brand-authorized specs and images, looked up by barcode.
 * It has no prices or keyword search, so it only fills in missing
 * descriptions and images on products that carry a GTIN.
 * Register at https://icecat.biz for ICECAT_USERNAME.
 */
export default {
  id: "icecat",
  label: "Open Icecat",
  kind: "enrichment",
  requires: ["ICECAT_USERNAME"],
  async enrich(product, { env, fetchImpl }) {
    const params = new URLSearchParams({ UserName: env.ICECAT_USERNAME, Language: "en", GTIN: product.gtin });
    const body = await requestJson(`https://live.icecat.biz/api?${params}`, { fetchImpl });
    const info = body.data?.GeneralInfo;
    if (!info) return null;
    return {
      description: stripHtml(info.SummaryDescription?.LongSummaryDescription || info.Description?.LongDesc),
      image: body.data?.Image?.HighPic || body.data?.Image?.Pic500x500 || null,
    };
  },
};
