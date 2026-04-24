FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

WORKDIR /work
