#!/usr/bin/env python3
"""
Builds the three Sinterklaas character models from MakeHuman's CC0 assets.

  python3 tools/build_sinter.py        -> assets/sinter/<variant>.json + .bin

Pipeline: MakeHuman base mesh (hm08) -> anatomical morph targets (age, build, face)
-> MakeHuman skeleton + skin weights -> fitted cassock + bell sleeves -> binary export.
Downloads are cached in tools/cache (not committed).
"""
import json, os, struct, urllib.request
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
OUT = os.path.join(ROOT, 'assets', 'sinter')
MH = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/'
SCALE = 0.1  # MakeHuman units are decimetres

def fetch(rel):
    path = os.path.join(CACHE, rel.replace('/', '__'))
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        urllib.request.urlretrieve(MH + rel, path)
    return path

# ------------------------------------------------------------------ base mesh
def load_obj():
    V, T, faces = [], [], []
    group = None
    for line in open(fetch('3dobjs/base.obj')):
        if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '): T.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '): group = line.split()[1]
        elif line.startswith('f '):
            idx = []
            for tok in line.split()[1:]:
                a = tok.split('/')
                idx.append((int(a[0]) - 1, int(a[1]) - 1 if len(a) > 1 and a[1] else 0))
            faces.append((group, idx))
    return np.array(V, dtype=np.float64), np.array(T, dtype=np.float64), faces

def load_target(rel):
    rows = []
    for line in open(fetch('targets/' + rel)):
        if not line.strip() or line.startswith('#'): continue
        p = line.split()
        rows.append((int(p[0]), float(p[1]), float(p[2]), float(p[3])))
    if not rows: return None
    a = np.array(rows)
    return a[:, 0].astype(int), a[:, 1:]

def apply_targets(V, targets):
    V = V.copy()
    for rel, w in targets.items():
        if not w: continue
        t = load_target(rel)
        if t is None: continue  # 'average' targets are empty: the base mesh already is average
        idx, d = t
        V[idx] += d * w
    return V

# ------------------------------------------------------------------ skeleton
def build_skeleton(V):
    sk = json.load(open(fetch('rigs/default.mhskel')))
    J = {name: V[ids].mean(axis=0) for name, ids in sk['joints'].items()}
    bones = sk['bones']
    order, seen = [], set()
    def visit(n):
        if n in seen: return
        p = bones[n]['parent']
        if p: visit(p)
        seen.add(n); order.append(n)
    for n in bones: visit(n)
    out = []
    for n in order:
        b = bones[n]
        out.append({'name': n, 'parent': b['parent'], 'head': J[b['head']].tolist(), 'tail': J[b['tail']].tolist()})
    return out

def load_weights(nverts, bone_index):
    W = json.load(open(fetch('rigs/default_weights.mhw')))['weights']
    per = [[] for _ in range(nverts)]
    for bname, lst in W.items():
        bi = bone_index.get(bname)
        if bi is None: continue
        for v, w in lst: per[v].append((w, bi))
    SI = np.zeros((nverts, 4), dtype=np.uint16)
    SW = np.zeros((nverts, 4), dtype=np.float32)
    for v, lst in enumerate(per):
        lst.sort(reverse=True)
        lst = lst[:4]
        tot = sum(w for w, _ in lst) or 1
        for k, (w, bi) in enumerate(lst):
            SI[v, k] = bi; SW[v, k] = w / tot
        if not lst: SW[v, 0] = 1; SI[v, 0] = bone_index['root']
    return SI, SW

# ------------------------------------------------------------------ parts
def extract(V, T, faces, groups, SI, SW):
    """Unique (vertex, uv) pairs -> flat arrays, quads -> triangles."""
    key, pos, uv, si, sw, src, tri = {}, [], [], [], [], [], []
    for g, idx in faces:
        if g not in groups: continue
        ids = []
        for vi, ti in idx:
            k = (vi, ti)
            if k not in key:
                key[k] = len(pos)
                pos.append(V[vi]); uv.append(T[ti] if len(T) else (0, 0)); si.append(SI[vi]); sw.append(SW[vi]); src.append(vi)
            ids.append(key[k])
        for k in range(1, len(ids) - 1): tri.append((ids[0], ids[k], ids[k + 1]))
    return {'pos': np.array(pos), 'uv': np.array(uv), 'si': np.array(si), 'sw': np.array(sw), 'idx': np.array(tri, dtype=np.uint32), 'src': np.array(src)}

def vertex_normals(pos, idx):
    n = np.zeros_like(pos)
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3): np.add.at(n, idx[:, k], fn)
    l = np.linalg.norm(n, axis=1, keepdims=True); l[l == 0] = 1
    return n / l

def nearest_weights(points, ref_pos, ref_si, ref_sw):
    si = np.zeros((len(points), 4), dtype=np.uint16); sw = np.zeros((len(points), 4), dtype=np.float32)
    for s in range(0, len(points), 128):
        p = points[s:s + 128]
        d = ((p[:, None, :] - ref_pos[None, :, :]) ** 2).sum(-1)
        j = d.argmin(1)
        si[s:s + 128] = ref_si[j]; sw[s:s + 128] = ref_sw[j]
    return si, sw

def dominant(si, sw, names):
    return np.array([names[si[i, 0]] for i in range(len(si))])

# ------------------------------------------------------------------ the cassock
def build_robe(body, bones, bone_names, cfg):
    """A long robe fitted around the body: rings of radii sampled from the body itself."""
    bi = {b['name']: i for i, b in enumerate(bones)}
    P = body['pos']; dom = dominant(body['si'], body['sw'], bone_names)
    arm = np.array([any(s in d for s in ('arm', 'wrist', 'finger', 'metacarpal', 'hand', 'shoulder', 'clavicle')) for d in dom])
    head = np.array([any(s in d for s in ('head', 'neck', 'jaw', 'eye', 'oris', 'oculi', 'levator', 'temporalis', 'tongue', 'special', 'orbicularis', 'risorius')) for d in dom])
    keep = ~arm & ~head
    Q = P[keep]
    pel = np.array(bones[bi['spine05']]['head'])
    neck = np.array(bones[bi['neck01']]['head'])
    ank = min(np.array(bones[bi['foot.L']]['head'])[1], np.array(bones[bi['foot.R']]['head'])[1])
    hip_y = pel[1]
    top = neck[1] - 0.15 * (neck[1] - hip_y)
    bottom = ank + cfg.get('hem', 0.06)
    A, Hn = 64, 46
    ys = np.linspace(top, bottom, Hn)
    cx, cz = pel[0], pel[2] + cfg.get('robe_z', 0.0)
    ang = np.linspace(0, 2 * np.pi, A, endpoint=False)
    R = np.zeros((Hn, A))
    dy = (top - bottom) / Hn * 1.6
    qa = np.arctan2(Q[:, 0] - cx, Q[:, 2] - cz) % (2 * np.pi)
    qr = np.hypot(Q[:, 0] - cx, Q[:, 2] - cz)
    for i, y in enumerate(ys):
        m = np.abs(Q[:, 1] - y) < dy
        for j, a in enumerate(ang):
            da = np.abs((qa[m] - a + np.pi) % (2 * np.pi) - np.pi)
            sel = da < 0.18
            R[i, j] = qr[m][sel].max() if sel.any() else 0
    # fill gaps, smooth, add cloth thickness, flare below the hips
    for i in range(Hn):
        row = R[i]
        if row.max() == 0: row[:] = R[i - 1] if i else 0.15
        row[row == 0] = row[row > 0].min() if (row > 0).any() else 0.15
    for _ in range(3):
        R = (np.roll(R, 1, 1) + R * 2 + np.roll(R, -1, 1)) / 4
        R[1:-1] = (R[:-2] + R[1:-1] * 2 + R[2:]) / 4
    thick = cfg.get('thick', 0.03)
    for i, y in enumerate(ys):
        below = max(0.0, hip_y - y)
        R[i] = R[i] + thick
        if y < hip_y:
            # legs disappear inside a skirt that widens toward the hem
            base = R[ys < hip_y + 0.02][0] if (ys < hip_y + 0.02).any() else R[i]
            flare = 1 + below * cfg.get('flare', 0.35)
            R[i] = np.maximum(R[i], base * flare)
    # make every ring at least as wide as the ring above it below the hips (no hourglass)
    for i in range(1, Hn):
        if ys[i] < hip_y: R[i] = np.maximum(R[i], R[i - 1])
    # shoulder slope: the top rings close in toward the neck
    pos, uv = [], []
    for i, y in enumerate(ys):
        for j in range(A + 1):
            a = ang[j % A] if j < A else 2 * np.pi
            r = R[i, j % A]
            hemwave = 0.0
            if i >= Hn - 3: hemwave = 0.012 * np.sin(a * 9)
            pos.append((cx + np.sin(a) * r, y + hemwave, cz + np.cos(a) * r))
            uv.append((j / A, (y - bottom) / (top - bottom)))
    # a cap of shoulders up to the collar
    tri = []
    W = A + 1
    for i in range(Hn - 1):
        for j in range(A):
            a0, a1, b0, b1 = i * W + j, i * W + j + 1, (i + 1) * W + j, (i + 1) * W + j + 1
            tri += [(a0, b0, a1), (a1, b0, b1)]
    pos = np.array(pos); uv = np.array(uv)
    si, sw = nearest_weights(pos, P[keep], body['si'][keep], body['sw'][keep])
    # skirt follows the pelvis more than the legs so it doesn't tear when walking
    pel_i = bi['root']
    for k, p in enumerate(pos):
        f = np.clip((hip_y - p[1]) / max(0.01, hip_y - bottom), 0, 1) * 0.75
        if f > 0:
            w = sw[k] * (1 - f)
            idxs = list(si[k]); ws = list(w)
            if pel_i in idxs: ws[idxs.index(pel_i)] += f
            else:
                m = int(np.argmin(ws)); idxs[m] = pel_i; ws[m] = f
            s = sum(ws); si[k] = idxs; sw[k] = np.array(ws) / s
    return {'pos': pos, 'uv': uv, 'si': si, 'sw': sw, 'idx': np.array(tri, dtype=np.uint32)}

def build_sleeves(V, T, faces, SI, SW, bone_names, cfg):
    """Bell sleeves from the MakeHuman tights shell's arm section, pushed outward toward the wrist."""
    sl = extract(V, T, faces, {'helper-tights'}, SI, SW)
    dom = dominant(sl['si'], sl['sw'], bone_names)
    is_arm = np.array([any(s in d for s in ('upperarm', 'lowerarm', 'shoulder', 'clavicle')) for d in dom])
    keep_tri = is_arm[sl['idx']].all(axis=1)
    idx = sl['idx'][keep_tri]
    n = vertex_normals(sl['pos'], sl['idx'])
    pos = sl['pos'].copy()
    xs = np.abs(pos[:, 0])
    span = xs[is_arm].max() - xs[is_arm].min() if is_arm.any() else 1
    t = np.clip((xs - xs[is_arm].min()) / span, 0, 1)
    push = cfg.get('sleeve', 0.02) + t ** 2 * cfg.get('bell', 0.07)
    pos = pos + n * push[:, None]
    used = np.unique(idx)
    remap = -np.ones(len(pos), dtype=np.int64); remap[used] = np.arange(len(used))
    return {'pos': pos[used], 'uv': sl['uv'][used], 'si': sl['si'][used], 'sw': sl['sw'][used], 'idx': remap[idx].astype(np.uint32)}

# ------------------------------------------------------------------ variants
OLD_THIN = {
    'macrodetails/universal-male-old-minmuscle-minweight.target': 1.0,
    'macrodetails/caucasian-male-old.target': 1.0,
}
FACE = lambda **kw: {f'{k.split("__")[0]}/{k.split("__")[1].replace("_", "-")}.target': v for k, v in kw.items()}

VARIANTS = {
    'nightmare': {
        'title': 'The Realistic Nightmare',
        'targets': {**OLD_THIN, 'macrodetails/height/male-old-minmuscle-minweight-maxheight.target': 0.6,
                    **FACE(cheek__l_cheek_volume_decr=1, cheek__r_cheek_volume_decr=1, cheek__l_cheek_bones_incr=0.8, cheek__r_cheek_bones_incr=0.8,
                           eyes__l_eye_bag_incr=1, eyes__r_eye_bag_incr=1, eyes__l_eye_push1_in=0.6, eyes__r_eye_push1_in=0.6,
                           nose__nose_hump_incr=0.8, nose__nose_point_down=0.6, nose__nose_scale_vert_incr=0.4,
                           head__head_fat_decr=1, head__head_age_incr=1, chin__chin_prominent_incr=0.5, neck__neck_scale_horiz_decr=0.6,
                           mouth__mouth_angles_down=0.8, mouth__mouth_lowerlip_volume_decr=0.5)},
        'robe': {'thick': 0.035, 'flare': 0.32, 'hem': 0.08, 'sleeve': 0.025, 'bell': 0.06},
    },
    'demonic': {
        'title': 'The Demonic Sinterklaas',
        'targets': {**OLD_THIN, 'macrodetails/height/male-old-minmuscle-minweight-maxheight.target': 1.0,
                    **FACE(cheek__l_cheek_volume_decr=1, cheek__r_cheek_volume_decr=1, cheek__l_cheek_bones_incr=1, cheek__r_cheek_bones_incr=1,
                           eyes__l_eye_push1_in=1, eyes__r_eye_push1_in=1, eyes__l_eye_push2_in=1, eyes__r_eye_push2_in=1,
                           head__head_scale_vert_incr=0.8, head__head_triangular=0.7, chin__chin_height_incr=1, chin__chin_jaw_drop_incr=1,
                           chin__chin_prominent_incr=1, nose__nose_scale_vert_incr=0.7, nose__nose_point_down=1,
                           neck__neck_scale_vert_incr=1, neck__neck_scale_horiz_decr=1, mouth__mouth_scale_horiz_incr=0.6)},
        'robe': {'thick': 0.03, 'flare': 0.45, 'hem': 0.02, 'sleeve': 0.03, 'bell': 0.12},
    },
    'uncanny': {
        'title': 'The Uncanny Sinterklaas',
        'targets': {'macrodetails/universal-male-old-averagemuscle-averageweight.target': 1.0, 'macrodetails/caucasian-male-old.target': 0.7,
                    **FACE(mouth__mouth_angles_up=1, mouth__mouth_scale_horiz_incr=1, mouth__mouth_laugh_lines_in=0.8, mouth__mouth_dimples_in=0.6,
                           cheek__l_cheek_volume_incr=0.6, cheek__r_cheek_volume_incr=0.6, cheek__l_cheek_trans_up=0.5, cheek__r_cheek_trans_up=0.5,
                           eyes__l_eye_scale_incr=0.7, eyes__r_eye_scale_incr=0.35, eyes__l_eye_trans_out=0.6, eyes__r_eye_trans_out=0.6,
                           eyes__r_eye_trans_up=0.35, eyes__l_eye_height2_incr=0.6, eyes__r_eye_height2_incr=0.6,
                           head__head_scale_horiz_incr=0.3, head__head_round=0.5, nose__nose_scale_horiz_decr=0.3)},
        'robe': {'thick': 0.04, 'flare': 0.3, 'hem': 0.07, 'sleeve': 0.03, 'bell': 0.05},
    },
}

def pack(parts, bones, meta, name):
    os.makedirs(OUT, exist_ok=True)
    blob = bytearray()
    header = {'bones': bones, 'meta': meta, 'parts': {}}
    def put(arr, dtype):
        nonlocal blob
        a = np.ascontiguousarray(arr, dtype=dtype)
        while len(blob) % 4: blob += b'\0'
        off = len(blob); blob += a.tobytes()
        return [off, a.size]
    for pname, p in parts.items():
        header['parts'][pname] = {
            'pos': put(p['pos'], np.float32), 'uv': put(p['uv'], np.float32),
            'si': put(p['si'], np.uint16), 'sw': put(p['sw'], np.float32), 'idx': put(p['idx'], np.uint32),
        }
    open(os.path.join(OUT, name + '.bin'), 'wb').write(blob)
    json.dump(header, open(os.path.join(OUT, name + '.json'), 'w'), separators=(',', ':'))
    return len(blob)

def main():
    V0, T, faces = load_obj()
    T[:, 1] = T[:, 1]
    for name, cfg in VARIANTS.items():
        V = apply_targets(V0, cfg['targets']) * SCALE
        V[:, 1] -= V[:, 1].min() if False else 0
        bones = build_skeleton(V)
        # stand on the floor
        bodyY = V[[i for g, idx in faces if g == 'body' for i, _ in idx]][:, 1].min()
        V[:, 1] -= bodyY
        for b in bones: b['head'][1] -= bodyY; b['tail'][1] -= bodyY
        names = [b['name'] for b in bones]
        bi = {n: i for i, n in enumerate(names)}
        SI, SW = load_weights(len(V), bi)
        parts = {
            'body': extract(V, T, faces, {'body'}, SI, SW),
            'teeth': extract(V, T, faces, {'helper-upper-teeth', 'helper-lower-teeth'}, SI, SW),
            'tongue': extract(V, T, faces, {'helper-tongue'}, SI, SW),
            'lashes': extract(V, T, faces, {k for k in {g for g, _ in faces} if 'eyelashes' in k}, SI, SW),
            'scalp': extract(V, T, faces, {'helper-hair'}, SI, SW),
        }
        parts['robe'] = build_robe(parts['body'], bones, names, cfg['robe'])
        parts['sleeves'] = build_sleeves(V, T, faces, SI, SW, names, cfg['robe'])
        eyes = {}
        for side in ('l', 'r'):
            ids = sorted({i for g, idx in faces if g == f'helper-{side}-eye' for i, _ in idx})
            c = V[ids].mean(0); r = np.linalg.norm(V[ids] - c, axis=1).mean()
            eyes[side] = {'c': c.tolist(), 'r': float(r)}
        meta = {'title': cfg['title'], 'eyes': eyes, 'height': float(V[parts['body']['src']][:, 1].max())}
        for p in parts.values(): p.pop('src', None)
        size = pack(parts, bones, meta, name)
        print(f'{name}: {len(parts["body"]["pos"])} body verts, robe {len(parts["robe"]["pos"])}, sleeves {len(parts["sleeves"]["pos"])}, height {meta["height"]:.2f} m, {size/1e6:.2f} MB')

if __name__ == '__main__':
    main()
