def polygon_area(points):
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def clip_polygon_with_rect(points, xmin, ymin, xmax, ymax):
    def clip_edge(poly, inside, intersect):
        if not poly:
            return []
        output = []
        prev = poly[-1]
        for curr in poly:
            if inside(curr):
                if inside(prev):
                    output.append(curr)
                else:
                    output.append(intersect(prev, curr))
                    output.append(curr)
            else:
                if inside(prev):
                    output.append(intersect(prev, curr))
            prev = curr
        return output

    poly = points

    poly = clip_edge(
        poly,
        lambda p: p[0] >= xmin,
        lambda p1, p2: _intersect_vertical(p1, p2, xmin),
    )
    poly = clip_edge(
        poly,
        lambda p: p[0] <= xmax,
        lambda p1, p2: _intersect_vertical(p1, p2, xmax),
    )
    poly = clip_edge(
        poly,
        lambda p: p[1] >= ymin,
        lambda p1, p2: _intersect_horizontal(p1, p2, ymin),
    )
    poly = clip_edge(
        poly,
        lambda p: p[1] <= ymax,
        lambda p1, p2: _intersect_horizontal(p1, p2, ymax),
    )
    return poly


def _intersect_vertical(p1, p2, x):
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        return (x, y1)
    t = (x - x1) / (x2 - x1)
    y = y1 + t * (y2 - y1)
    return (x, y)


def _intersect_horizontal(p1, p2, y):
    x1, y1 = p1
    x2, y2 = p2
    if y1 == y2:
        return (x1, y)
    t = (y - y1) / (y2 - y1)
    x = x1 + t * (x2 - x1)
    return (x, y)


def overlap_ratio(zone_polygon, bbox):
    x1, y1, x2, y2 = bbox
    bbox_area = max(0.0, (x2 - x1)) * max(0.0, (y2 - y1))
    if bbox_area <= 0:
        return 0.0
    clipped = clip_polygon_with_rect(zone_polygon, x1, y1, x2, y2)
    intersection_area = polygon_area(clipped)
    return intersection_area / bbox_area


def point_in_polygon(x, y, polygon):
    inside = False
    n = len(polygon)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) if (yj - yi) != 0 else 1e-9) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside
