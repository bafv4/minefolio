// OGP画像テスト用ページ
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function meta() {
  return [
    { title: "OGP画像テスト - Minefolio" },
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
      <h1 className="text-3xl font-bold mb-6">OGP画像生成テスト</h1>

      <div className="grid gap-6">
        {/* コントロールパネル */}
        <Card>
          <CardHeader>
            <CardTitle>パラメータ設定</CardTitle>
            <CardDescription>
              プレイヤーのMCIDを入力して、OGP画像を生成します
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcid">MCID</Label>
              <Input
                id="mcid"
                value={mcid}
                onChange={(e) => setMcid(e.target.value)}
                placeholder="例: Dream, Illumina"
              />
            </div>

            <Button onClick={generatePreview} className="w-full">
              プレビュー生成
            </Button>
          </CardContent>
        </Card>

        {/* プレビュー */}
        {imageUrl && (
          <Card>
            <CardHeader>
              <CardTitle>プレビュー</CardTitle>
              <CardDescription>
                1200x630px (Twitter/OGP標準サイズ)
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
                <Label>画像URL</Label>
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
                    コピー
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>新しいタブで開く</Label>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(imageUrl, "_blank")}
                >
                  SVG画像を開く
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 使い方 */}
        <Card>
          <CardHeader>
            <CardTitle>使い方</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              • このページはOGP画像が正しく生成されるかテストするためのものです
            </p>
            <p>
              • MCIDを入力して「プレビュー生成」をクリックすると、そのプレイヤーのOGP画像が表示されます
            </p>
            <p>
              • 画像は1200x630pxのSVG形式で生成されます
            </p>
            <p>
              • プレイヤーが存在しない場合は404エラーが返されます
            </p>
          </CardContent>
        </Card>

        {/* サンプルMCID */}
        <Card>
          <CardHeader>
            <CardTitle>サンプルMCID</CardTitle>
            <CardDescription>
              クリックして自動入力
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
