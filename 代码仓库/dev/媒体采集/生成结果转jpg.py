# 生成结果 PNG → JPG（q88）：省存储与上传体积；转换成功后删除源 PNG
# 用法：python -I 代码仓库/dev/媒体采集/生成结果转jpg.py  （在仓库根执行）
import os
import sys

from PIL import Image


def main(root: str) -> None:
    n_ok = n_fail = 0
    for dirpath, _, files in os.walk(root):
        for f in files:
            if not f.lower().endswith('.png'):
                continue
            src = os.path.join(dirpath, f)
            dst = os.path.splitext(src)[0] + '.jpg'
            try:
                if os.path.exists(dst):
                    os.remove(src)
                    n_ok += 1
                    continue
                im = Image.open(src)
                if im.mode != 'RGB':
                    im = im.convert('RGB')
                im.save(dst, 'JPEG', quality=88, optimize=True)
                os.remove(src)
                n_ok += 1
            except Exception as e:  # noqa: BLE001
                print('fail', src, e)
                n_fail += 1
    print(f'converted={n_ok} failed={n_fail}')


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '.scratch-20261119/生成结果'
    main(root)
