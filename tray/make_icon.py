from PIL import Image, ImageDraw

SIZE = 256
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# круг в цвете Telegram
d.ellipse([8, 8, SIZE - 8, SIZE - 8], fill=(51, 144, 236, 255))

# бумажный самолётик
plane = [
    (58, 132), (196, 70), (150, 186), (126, 150), (112, 178), (104, 146),
]
d.polygon(plane, fill=(255, 255, 255, 255))
d.polygon([(126, 150), (196, 70), (150, 186)], fill=(225, 238, 252, 255))

img.save("assets/icon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon.ico written")
