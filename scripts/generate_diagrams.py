from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
BACKGROUND = "#F7F3EA"
INK = "#231F20"
GOLD = "#B48A3C"
PINK = "#D96C92"
BLUE = "#3A657A"
WHITE = "#FFFFFF"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
        if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def box(
    draw: ImageDraw.ImageDraw,
    bounds: tuple[int, int, int, int],
    title: str,
    subtitle: str,
    fill: str = WHITE,
) -> None:
    draw.rounded_rectangle(bounds, radius=20, fill=fill, outline=GOLD, width=3)
    x1, y1, x2, _ = bounds
    draw.text(((x1 + x2) / 2, y1 + 27), title, font=font(25, True), fill=INK, anchor="mm")
    draw.multiline_text(
        ((x1 + x2) / 2, y1 + 72),
        subtitle,
        font=font(17),
        fill=INK,
        anchor="mm",
        align="center",
        spacing=5,
    )


def arrow(
    draw: ImageDraw.ImageDraw,
    start: tuple[int, int],
    end: tuple[int, int],
    color: str = BLUE,
) -> None:
    draw.line([start, end], fill=color, width=5)
    x, y = end
    draw.polygon([(x, y), (x - 14, y - 9), (x - 14, y + 9)], fill=color)


def title(draw: ImageDraw.ImageDraw, heading: str, subheading: str) -> None:
    draw.text((60, 42), heading, font=font(36, True), fill=INK)
    draw.text((60, 92), subheading, font=font(20), fill=BLUE)


def render_interactions() -> None:
    image = Image.new("RGB", (1500, 900), BACKGROUND)
    draw = ImageDraw.Draw(image)
    title(draw, "Jolene agent interactions", "One Carl-first core, with tools and external coordination behind policy")

    box(draw, (70, 325, 325, 520), "Carl", "Goals\nDecisions\nApprovals", "#FFF9F0")
    box(draw, (500, 270, 1000, 575), "Jolene Core", "Conversation · Planning · Personality · Task State\n\nSafety: permissions · privacy · approval", "#FFF2F6")
    box(draw, (1175, 170, 1430, 355), "Knowledge", "Obsidian\nProjects\nConversation")
    box(draw, (1175, 410, 1430, 595), "Capabilities", "Research\nFiles · Code\nSpecialists")
    box(draw, (500, 690, 1000, 835), "Optional coordination", "Slack · Clients · Other AIs", "#EFF7FA")

    arrow(draw, (325, 422), (500, 422))
    arrow(draw, (1000, 335), (1175, 265))
    arrow(draw, (1000, 475), (1175, 500))
    draw.line([(750, 575), (750, 690)], fill=BLUE, width=5)
    draw.polygon([(750, 690), (741, 676), (759, 676)], fill=BLUE)

    draw.text((70, 805), "External actions return to Carl for exact approval.", font=font(19, True), fill=PINK)
    image.save(DOCS / "agent-interactions.png", optimize=True)


def render_sequence() -> None:
    image = Image.new("RGB", (1500, 900), BACKGROUND)
    draw = ImageDraw.Draw(image)
    title(draw, "Jolene request sequence", "Ground first, approve consequential work, then add personality")

    steps = [
        ("1", "Input", "Message or scheduled trigger"),
        ("2", "Identity", "Actor · channel · thread"),
        ("3", "Policy", "Permission and disclosure check"),
        ("4", "Context", "Recent state + cited knowledge"),
        ("5", "Work", "Reason · tools · specialists"),
        ("6", "Approval", "Only when external or sensitive"),
        ("7", "Response", "Grounded answer + Jolene behavior"),
        ("8", "Record", "Task state · citations · audit"),
    ]

    y = 155
    for number, heading, detail in steps:
        draw.ellipse((85, y, 145, y + 60), fill=PINK if number in {"6", "7"} else BLUE)
        draw.text((115, y + 30), number, font=font(22, True), fill=WHITE, anchor="mm")
        draw.rounded_rectangle((185, y - 5, 1390, y + 65), radius=16, fill=WHITE, outline=GOLD, width=2)
        draw.text((220, y + 17), heading, font=font(22, True), fill=INK)
        draw.text((520, y + 18), detail, font=font(20), fill=INK)
        if number != "8":
            draw.line((115, y + 60, 115, y + 88), fill=BLUE, width=4)
        y += 88

    image.save(DOCS / "agent-sequence.png", optimize=True)


if __name__ == "__main__":
    DOCS.mkdir(parents=True, exist_ok=True)
    render_interactions()
    render_sequence()
