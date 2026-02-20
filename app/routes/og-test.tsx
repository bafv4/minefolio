// OGP画像テスト用ページ
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/lib/messages";

export function meta() {
  return [
    { title: t("ogTest.title") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export default function OgpTestPage() {
  const [mcid, setMcid] = useState("Dream");
  const [imageUrl, setImageUrl] = useState("");
  const [scale, setScale] = useState("4");

  const generatePreview = () => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    setImageUrl(`${baseUrl}/og-image?mcid=${encodeURIComponent(mcid)}`);
  };

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="text-3xl font-bold mb-6">{t("ogTest.heading")}</h1>

      <div className="grid gap-6">
        {/* コントロールパネル */}
        <Card>
          <CardHeader>
            <CardTitle>{t("ogTest.paramTitle")}</CardTitle>
            <CardDescription>
              {t("ogTest.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcid">MCID</Label>
              <Input
                id="mcid"
                value={mcid}
                onChange={(e) => setMcid(e.target.value)}
                placeholder={t("ogTest.mcidExample")}
              />
            </div>

            <Button onClick={generatePreview} className="w-full">
              {t("ogTest.generatePreview")}
            </Button>
          </CardContent>
        </Card>

        {/* プレビュー */}
        {imageUrl && (
          <Card>
            <CardHeader>
              <CardTitle>{t("ogTest.preview")}</CardTitle>
              <CardDescription>
                {t("ogTest.previewSize")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border rounded-lg overflow-hidden bg-muted">
                <img
                  src={imageUrl}
                  alt="OGP Preview"
                  className="w-full h-auto"
                  style={{ aspectRatio: "1200/630" }}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("ogTest.imageUrl")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={imageUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(imageUrl);
                    }}
                  >
                    {t("ogTest.copy")}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("ogTest.openInNewTab")}</Label>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(imageUrl, "_blank")}
                >
                  {t("ogTest.openSvg")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 使い方 */}
        <Card>
          <CardHeader>
            <CardTitle>{t("ogTest.usage")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              {t("ogTest.usageLine1")}
            </p>
            <p>
              {t("ogTest.howToRunnerImage")}
            </p>
            <p>
              {t("ogTest.usageLine3")}
            </p>
            <p>
              {t("ogTest.howToNotFound")}
            </p>
          </CardContent>
        </Card>

        {/* サンプルMCID */}
        <Card>
          <CardHeader>
            <CardTitle>{t("ogTest.sampleMcid")}</CardTitle>
            <CardDescription>
              {t("ogTest.clickToAutoFill")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {["Dream", "Illumina", "Couriway", "k4yfour", "Feinberg"].map((name) => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMcid(name);
                    setImageUrl("");
                  }}
                >
                  {name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
