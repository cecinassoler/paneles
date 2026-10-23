# Convierte "Metas vendedores.xlsx" al texto separado por tabulaciones que lee metas.mjs.
# Uso: python3 metas_xlsx.py <metas.xlsx> <metas.txt> [anio.txt]
# El anio se toma de una celda tipo "Año 2027" / "Año:" + celda 2027, o del nombre de la hoja ("Metas 2027").
# Toma la primera hoja que tenga una fila con "Enero" y "Diciembre" y una fila "TOTAL".
import re
import sys
import unicodedata
import openpyxl


def norm(v):
    s = '' if v is None else str(v)
    s = unicodedata.normalize('NFD', s.strip().lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


def celda(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).replace('\t', ' ').replace('\n', ' ')


def buscar_anio(ws, filas):
    for f in filas:
        for j, c in enumerate(f):
            t = norm(c)
            m = re.match(r'^ano\b\D{0,5}(20\d\d)$', t)
            if m:
                return m.group(1)
            if re.match(r'^ano\s*:?$', t):
                for c2 in f[j + 1:j + 3]:
                    m2 = re.match(r'^(20\d\d)(\.0)?$', norm(c2))
                    if m2:
                        return m2.group(1)
    m = re.search(r'\b(20\d\d)\b', ws.title)
    return m.group(1) if m else None


def main(src, dst, dst_anio=None):
    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    for ws in wb.worksheets:
        filas = [list(r) for r in ws.iter_rows(values_only=True)]
        hay_meses = any('enero' in [norm(c) for c in f] and 'diciembre' in [norm(c) for c in f] for f in filas)
        col_total = None
        for f in filas:
            for j, c in enumerate(f):
                if norm(c) == 'total':
                    col_total = j
                    break
            if col_total is not None:
                break
        if not hay_meses or col_total is None:
            continue
        # la columna de nombres (donde esta "TOTAL") pasa a ser la primera columna del texto
        lineas = ['\t'.join(celda(c) for c in f[col_total:]) for f in filas]
        with open(dst, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(lineas) + '\n')
        anio = buscar_anio(ws, filas)
        if dst_anio and anio:
            with open(dst_anio, 'w', encoding='utf-8') as fh:
                fh.write(anio + '\n')
        print(f'Metas: hoja "{ws.title}" convertida ({len(filas)} filas), ano: ' + (anio or 'no indicado en la planilla'))
        return 0
    print('Metas: no encontre una hoja con la fila de meses (Enero..Diciembre) y la fila TOTAL')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
