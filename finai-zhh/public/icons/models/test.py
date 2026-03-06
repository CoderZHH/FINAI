import os
from PIL import Image, ImageOps

def make_circle(img: Image.Image):
    # 转成正方形（取最短边），并居中裁剪
    size = min(img.size)
    img = ImageOps.fit(img, (size, size), centering=(0.5, 0.5))

    # 创建圆形遮罩
    mask = Image.new('L', (size, size), 0)
    mask_draw = Image.new('L', (size, size), 0)
    for x in range(size):
        for y in range(size):
            if (x - size/2)**2 + (y - size/2)**2 <= (size/2)**2:
                mask_draw.putpixel((x, y), 255)
    mask = mask_draw

    # 应用遮罩（保留圆形区域，背景透明）
    img = img.convert("RGBA")
    img.putalpha(mask)

    return img


def process_all_images():
    input_dir = "."
    output_dir = "./output"

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    supported = (".jpg", ".jpeg", ".png", ".bmp", ".webp")

    for file in os.listdir(input_dir):
        if file.lower().endswith(supported):
            img = Image.open(file)
            circle_img = make_circle(img)

            output_path = os.path.join(output_dir, os.path.splitext(file)[0] + ".png")
            circle_img.save(output_path, format="PNG")

            print(f"已处理：{file} → {output_path}")


if __name__ == "__main__":
    process_all_images()
