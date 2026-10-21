from PIL import Image, ImageDraw

SIZE = 256
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# корпус диска
d.rounded_rectangle([18, 62, 238, 196], radius=26, fill=(30, 122, 214, 255), outline=(18, 82, 150, 255), width=4)
# верхняя панель
d.rounded_rectangle([18, 62, 238, 112], radius=26, fill=(64, 164, 240, 255))
d.rectangle([18, 96, 238, 112], fill=(64, 164, 240, 255))
# «блин» и шпиндель
d.ellipse([120, 92, 214, 186], fill=(232, 243, 255, 255))
d.ellipse([152, 124, 182, 154], fill=(30, 122, 214, 255))
# прорезь и индикатор
d.rounded_rectangle([40, 132, 96, 148], radius=8, fill=(24, 96, 172, 255))
d.ellipse([46, 168, 62, 184], fill=(126, 232, 150, 255))

img.save("assets/icon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icon.ico written")
