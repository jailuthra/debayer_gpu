import os
import sys
import numpy as np
import ctypes
from pixutils.formats import PixelFormat, PixelFormats
from pixutils.conv.raw import RawFormat
from dataclasses import dataclass
from OpenGL.GL import *
from OpenGL.GL.shaders import compileProgram, compileShader
from PyQt6.QtWidgets import QApplication, QMainWindow
from PyQt6.QtOpenGLWidgets import QOpenGLWidget
from PyQt6.QtCore import Qt


@dataclass
class ImageParams:
    fmt: PixelFormat
    black_level: float
    white_level: float
    white_balance: list[float]
    gamma: float

    def get_bpp(self):
        return RawFormat.from_pixelformat(self.fmt).bits_per_pixel

    def get_bayer_pattern(self):
        match self.fmt.name[1:5]:
            case 'BGGR':
                return 0
            case 'GBRG':
                return 1
            case 'GRBG':
                return 2
            case 'RGGB':
                return 3
        print(f"Pixelformat not supported by shader: {self.fmt}")
        return 0


class OpenGLImageWidget(QOpenGLWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.shader_program = None
        self.VAO = None
        self.VBO = None
        self.EBO = None
        self.texture_id = None
        self.image_data = bytes()
        self.texture_w = 640
        self.texture_h = 480
        self.image_params = ImageParams(
            black_level=(16 / 255), white_level=1.0,
            white_balance=[1.8, 1.0, 1.5],
            gamma=2.2, fmt=PixelFormats.SRGGB10)

    def load_shaders(self, vertex_shader_path, fragment_shader_path):
        """Loads and compiles shaders from files."""
        with open(vertex_shader_path, 'r') as f:
            vertex_shader_code = f.read()
        with open(fragment_shader_path, 'r') as f:
            fragment_shader_code = f.read()

        vertex_shader = compileShader(vertex_shader_code, GL_VERTEX_SHADER)
        fragment_shader = compileShader(fragment_shader_code, GL_FRAGMENT_SHADER)
        return compileProgram(vertex_shader, fragment_shader)

    def init_texture(self):
        """Prepares an OpenGL texture."""
        try:
            texture_id = glGenTextures(1)
            glBindTexture(GL_TEXTURE_2D, texture_id)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)
            return texture_id
        except Exception as e:
            print(f"Error loading texture: {e}")
            return None

    def load_image_data(self, image_data, fmt: PixelFormat, w, h):
        self.image_data = bytes(image_data)
        self.texture_w = w
        self.texture_h = h
        self.image_params.fmt = fmt

    def load_texture(self):
        """Loads a raw image file into an OpenGL texture."""
        if self.image_params.get_bpp() == 8:
            tex_type = GL_UNSIGNED_BYTE
        else:
            tex_type = GL_UNSIGNED_SHORT
        try:
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RED, self.texture_w, self.texture_h,
                         0, GL_RED, tex_type, self.image_data)
        except FileNotFoundError:
            print(f"Error: Image file not found at {image_path}")
        except Exception as e:
            print(f"Error loading texture: {e}")

    def initializeGL(self):
        """Initialize OpenGL context and resources."""
        # Load shaders
        module_dir = os.path.dirname(__file__)
        self.shader_program = self.load_shaders(
            os.path.join(module_dir, "shaders/simple.vert"),
            os.path.join(module_dir, "shaders/bayer.frag"))

        # Define vertices for full-screen quad
        # 2D vertex coordinate + 2D texture coordinates
        vertices = np.array([
            -1.0,  1.0, 0.0, 0.0, # top left
            -1.0, -1.0, 0.0, 1.0, # bottom left
             1.0, -1.0, 1.0, 1.0, # bottom right
             1.0,  1.0, 1.0, 0.0, # top right
        ], dtype=np.float32)

        indices = np.array([
            0, 1, 2, # bottom left triangle
            0, 3, 2, # top right triangle
        ], dtype=np.uint16)

        # Create VAO, VBO, EBO
        self.VAO = glGenVertexArrays(1)
        self.VBO = glGenBuffers(1)
        self.EBO = glGenBuffers(1)

        glBindVertexArray(self.VAO)

        glBindBuffer(GL_ARRAY_BUFFER, self.VBO)
        glBufferData(GL_ARRAY_BUFFER, vertices.nbytes, vertices, GL_STATIC_DRAW)

        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, self.EBO)
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.nbytes, indices, GL_STATIC_DRAW)

        glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * 4, ctypes.c_void_p(0))
        glEnableVertexAttribArray(0)

        glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * 4, ctypes.c_void_p(2 * 4))
        glEnableVertexAttribArray(1)

    def paintGL(self):
        """Render the scene."""
        glClear(GL_COLOR_BUFFER_BIT)

        glUseProgram(self.shader_program)

        p = self.image_params

        black_level_loc = glGetUniformLocation(self.shader_program, 'blackLevel')
        glUniform1f(black_level_loc, p.black_level)

        white_level_loc = glGetUniformLocation(self.shader_program, 'whiteLevel')
        glUniform1f(white_level_loc, p.white_level)

        wb_loc = glGetUniformLocation(self.shader_program, 'whiteBalance')
        glUniform3fv(wb_loc, 1, np.array(p.white_balance, dtype=np.float32))
        self.wb_loc = wb_loc

        gamma_loc = glGetUniformLocation(self.shader_program, 'gamma')
        glUniform1f(gamma_loc, p.gamma)

        bayer_pattern_loc = glGetUniformLocation(self.shader_program, 'bayerPattern')
        glUniform1i(bayer_pattern_loc, self.image_params.get_bayer_pattern())

        if p.get_bpp() == 8:
            scaling_factor = 1.0
        else:
            scaling_factor = 2 ** (16 - p.get_bpp())

        scaling_factor_loc = glGetUniformLocation(self.shader_program, 'scalingFactor')
        glUniform1f(scaling_factor_loc, scaling_factor)

        # Clean old texture
        if self.texture_id is not None:
            glDeleteTextures(1, [self.texture_id])
            self.texture_id = None

        # Load texture
        self.texture_id = self.init_texture()
        if self.texture_id is None:
            print("Failed to init texture")

        self.load_texture()
        glBindTexture(GL_TEXTURE_2D, self.texture_id)
        glBindVertexArray(self.VAO)
        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, None)

    def resizeGL(self, width, height):
        """Handle window resize."""
        glViewport(0, 0, width, height)

    def cleanup(self):
        """Clean up OpenGL resources."""
        if self.VBO is not None:
            glDeleteBuffers(1, [self.VBO])
        if self.VAO is not None:
            glDeleteVertexArrays(1, [self.VAO])
        if self.shader_program is not None:
            glDeleteProgram(self.shader_program)
