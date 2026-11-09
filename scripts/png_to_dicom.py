"""検査用: パノラマの PNG を Modality PX の DICOM（1 枚・8bit・MONOCHROME2）にする。

患者情報は合成（実在の患者ではない）。UID は毎回新規（同じ UID のまま作り直すと、アプリに古いメタデータが残ることがある）。
PixelSpacing は既定では書かない。--pixel-spacing を付けると、その値（mm・合成の値。パノラマの拡大率は位置で変わり、mm は信用できない）を書く。
本体は画素間隔が無い画像には ROI を置けない（createRoi の no-geometry）ので、置ける経路の検査には付ける。画像には焼き込みの文字（側方マーカー R・機種名）があるが、患者情報は含まない。BurnedInAnnotation は書かない
（YES と宣言した画像は、本体がマスクの登録なしには計算機へ渡さない: RemoteBurnPolicy の burnin-declared。local でも同じ）。

  python3 -I png_to_dicom.py IN.png OUT.dcm [--patient-id ID] [--pixel-spacing MM]
"""
import argparse
import datetime

import numpy as np
import pydicom
from PIL import Image
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

DX_FOR_PRESENTATION = '1.2.840.10008.5.1.4.1.1.1.1'


def build(png, patient_id='DENTAL-SPIKE', pixel_spacing=None):
    a = np.asarray(Image.open(png).convert('L'), dtype=np.uint8)
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = DX_FOR_PRESENTATION
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset(None, {}, file_meta=meta, preamble=b'\0' * 128)
    now = datetime.datetime.now()
    ds.SOPClassUID = DX_FOR_PRESENTATION
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID, ds.SeriesInstanceUID = generate_uid(), generate_uid()
    ds.PatientID, ds.PatientName = patient_id, 'SPIKE^PANO'
    ds.PatientBirthDate, ds.PatientSex = '', ''
    ds.StudyDate = ds.SeriesDate = ds.ContentDate = now.strftime('%Y%m%d')
    ds.StudyTime = ds.SeriesTime = ds.ContentTime = now.strftime('%H%M%S')
    ds.AccessionNumber, ds.StudyID, ds.ReferringPhysicianName = 'SPIKE1', '1', ''
    ds.Modality, ds.BodyPartExamined = 'PX', 'JAW'
    ds.StudyDescription, ds.SeriesDescription = 'Synthetic panoramic check', 'Panoramic'
    ds.SeriesNumber, ds.InstanceNumber = 1, 1
    ds.PresentationIntentType = 'FOR PRESENTATION'
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, 'MONOCHROME2'
    ds.Rows, ds.Columns = a.shape
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
    if pixel_spacing:
        ds.PixelSpacing = [pixel_spacing, pixel_spacing]
    ds.PixelData = a.tobytes()
    return ds


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('png')
    ap.add_argument('out')
    ap.add_argument('--patient-id', default='DENTAL-SPIKE')
    ap.add_argument('--pixel-spacing', type=float, default=None)
    a = ap.parse_args()
    ds = build(a.png, a.patient_id, a.pixel_spacing)
    ds.save_as(a.out, enforce_file_format=True)
    r = pydicom.dcmread(a.out)
    assert r.Modality == 'PX' and r.pixel_array.shape == (r.Rows, r.Columns) and r.pixel_array.dtype == np.uint8
    print(a.out, r.Rows, r.Columns, r.Modality, r.SOPInstanceUID)
