from PIL import Image, ImageOps, ImageDraw, ImageFilter

# Paths
main_path = r"C:\Users\tomto\.gemini\antigravity\brain\9506179d-9401-44b2-9a79-d339f6b89f40\stationery_aid_final_color_highres_1768265736844.png"
filler_path = r"C:\Users\tomto\.gemini\antigravity\brain\9506179d-9401-44b2-9a79-d339f6b89f40\stationery_aid_final_exact_logo_1768265545721.png"
output_path = r"c:\Users\tomto\OneDrive\Desktop\volunteer-tracker\assets\background_v8.png"

# Config
CANVAS_W, CANVAS_H = 1920, 1080
BG_COLOR = "#0f0f1a"

def create_mask(size, fade_pixels=50):
    mask = Image.new("L", size, 255)
    draw = ImageDraw.Draw(mask)
    # Fade left
    for x in range(fade_pixels):
        alpha = int(255 * (x / fade_pixels))
        draw.line([(x, 0), (x, size[1])], fill=alpha)
    # Fade right
    for x in range(size[0] - fade_pixels, size[0]):
        alpha = int(255 * ((size[0] - x) / fade_pixels))
        draw.line([(x, 0), (x, size[1])], fill=alpha)
    # Fade top
    for y in range(fade_pixels):
        alpha = int(255 * (y / fade_pixels))
        draw.line([(0, y), (size[0], y)], fill=alpha)
    # Fade bottom
    for y in range(size[1] - fade_pixels, size[1]):
        alpha = int(255 * ((size[1] - y) / fade_pixels))
        draw.line([(0, y), (size[0], y)], fill=alpha)
    return mask

def main():
    # Load images
    main_img = Image.open(main_path).convert("RGBA")
    filler_img = Image.open(filler_path).convert("RGBA")
    
    # Create canvas
    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), BG_COLOR)
    
    # Calculate centering for Main
    main_x = (CANVAS_W - main_img.width) // 2
    main_y = (CANVAS_H - main_img.height) // 2
    
    # --- FILLERS ---
    # Left Filler: Take left 500px of filler image
    left_filler = filler_img.crop((0, 0, 500, filler_img.height))
    # Right Filler: Take right 500px of filler image
    right_filler = filler_img.crop((filler_img.width - 500, 0, filler_img.width, filler_img.height))
    
    # Apply soft mask to fillers so they don't have hard edges near the center
    # We only need to fade the side touching the center
    left_mask = Image.new("L", left_filler.size, 255)
    l_draw = ImageDraw.Draw(left_mask)
    for x in range(400, 500): # Fade last 100px
         alpha = int(255 * ((500 - x) / 100))
         l_draw.line([(x, 0), (x, left_filler.height)], fill=alpha)
    left_filler.putalpha(left_mask)

    right_mask = Image.new("L", right_filler.size, 255)
    r_draw = ImageDraw.Draw(right_mask)
    for x in range(0, 100): # Fade first 100px
         alpha = int(255 * (x / 100))
         r_draw.line([(x, 0), (x, right_filler.height)], fill=alpha)
    right_filler.putalpha(right_mask)
    
    # Paste Fillers
    canvas.paste(left_filler, (0, (CANVAS_H - left_filler.height)//2), left_filler)
    canvas.paste(right_filler, (CANVAS_W - right_filler.width, (CANVAS_H - right_filler.height)//2), right_filler)
    
    # --- MAIN IMAGE ---
    # Apply a very subtle edge feather to Main Layer to blend hard cuts
    main_mask = create_mask(main_img.size, fade_pixels=40)
    main_img.putalpha(main_mask)
    
    # Paste Main
    canvas.paste(main_img, (main_x, main_y), main_img)
    
    # Save
    canvas.save(output_path)
    print(f"Composed image saved to {output_path}")

if __name__ == "__main__":
    main()
